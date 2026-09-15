import { describe, expect, it } from "vitest";
import { LymitConfigError } from "../errors.js";
import type { ResolvedTokenBucketConfig } from "../types.js";
import { tokenBucket, type TokenBucketState } from "./token-bucket.js";

// 5000 tokens capacity, refilling 1000 tokens per hour (the business-plan example).
const config: ResolvedTokenBucketConfig = {
  algorithm: "tokenBucket",
  capacity: 5000,
  refillRate: 1000,
  intervalMs: 3_600_000,
};
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

describe("tokenBucket", () => {
  it("starts full and deducts the cost on the first call", () => {
    const { state, response } = tokenBucket(null, config, T0, 150);
    expect(state).toEqual<TokenBucketState>({ tokens: 4850, lastRefill: T0 });
    // reset = when full again: 150 tokens at 1000/h = 9 minutes.
    expect(response).toEqual({
      success: true,
      limit: 5000,
      remaining: 4850,
      reset: T0 + 9 * 60_000,
    });
  });

  it("defaults cost to 1", () => {
    expect(tokenBucket(null, config, T0).state.tokens).toBe(4999);
  });

  it("rejects when the cost exceeds the available tokens, without consuming", () => {
    const low: TokenBucketState = { tokens: 100, lastRefill: T0 };
    const { state, response } = tokenBucket(low, config, T0, 150);
    expect(response.success).toBe(false);
    expect(response.remaining).toBe(100);
    expect(state).toEqual(low);
  });

  it("refills lazily in proportion to elapsed time", () => {
    const empty: TokenBucketState = { tokens: 0, lastRefill: T0 };
    // Half an hour later: 500 tokens refilled.
    const { state, response } = tokenBucket(empty, config, T0 + HOUR / 2, 200);
    expect(response.success).toBe(true);
    expect(state.tokens).toBe(300);
    expect(response.remaining).toBe(300);
  });

  it("never refills beyond capacity, even after a very long idle", () => {
    const empty: TokenBucketState = { tokens: 0, lastRefill: T0 };
    const { state } = tokenBucket(empty, config, T0 + HOUR * 1000, 0);
    expect(state.tokens).toBe(5000);
  });

  it("accumulates fractional refill across calls without losing tokens to rounding", () => {
    // 1000 tokens/hour = 1 token every 3.6s. Poll every 1s for 36s: must yield exactly 10.
    let state: TokenBucketState = { tokens: 0, lastRefill: T0 };
    for (let s = 1; s <= 36; s++) {
      state = tokenBucket(state, config, T0 + s * 1_000, 0).state;
    }
    expect(Math.floor(state.tokens)).toBe(10);
  });

  it("reports integer remaining, rounded down", () => {
    const state: TokenBucketState = { tokens: 0, lastRefill: T0 };
    // 1s later: 0.277… tokens. remaining must be 0, not 0.277.
    expect(tokenBucket(state, config, T0 + 1_000, 0).response.remaining).toBe(0);
  });

  it("rejects a cost larger than capacity and flags it as impossible", () => {
    const { state, response } = tokenBucket(null, config, T0, 6000);
    expect(response.success).toBe(false);
    expect(response.remaining).toBe(5000);
    expect(state.tokens).toBe(5000);
    // No amount of waiting helps; retryAfter is omitted rather than misleading.
    expect(response).not.toHaveProperty("retryAfter");
    expect(response.reset).toBe(T0);
  });

  describe("reset and retryAfter", () => {
    it("reset is 'now' when the bucket is already full", () => {
      expect(tokenBucket(null, config, T0, 0).response.reset).toBe(T0);
    });

    it("reset is when the bucket will be full again after a successful deduction", () => {
      // 4850 left, need 150 more to be full: 150 / 1000 per hour = 9 minutes.
      const { response } = tokenBucket(null, config, T0, 150);
      expect(response.reset).toBe(T0 + 9 * 60_000);
    });

    it("on rejection, reset and retryAfter are when the requested cost becomes affordable", () => {
      const state: TokenBucketState = { tokens: 100, lastRefill: T0 };
      // Need 50 more tokens: 50 / 1000 per hour = 3 minutes.
      const { response } = tokenBucket(state, config, T0, 150);
      expect(response.retryAfter).toBe(3 * 60_000);
      expect(response.reset).toBe(T0 + 3 * 60_000);
      // Sanity: at that moment the same request succeeds.
      expect(tokenBucket(state, config, T0 + 3 * 60_000, 150).response.success).toBe(true);
    });

    it("rounds retryAfter up so a retry at that time never fails by a millisecond", () => {
      const state: TokenBucketState = { tokens: 0, lastRefill: T0 };
      const { response } = tokenBucket(state, config, T0, 1);
      // 1 token = 3600ms exactly here; use a rate that does not divide evenly.
      const odd: ResolvedTokenBucketConfig = { ...config, refillRate: 7, intervalMs: 1_000 };
      const r = tokenBucket(state, odd, T0, 1);
      expect(response.retryAfter).toBe(3_600);
      expect(r.response.retryAfter).toBe(143); // ceil(1000/7)
      expect(tokenBucket(state, odd, T0 + 143, 1).response.success).toBe(true);
    });
  });

  it("does not refill negatively if the stored lastRefill is ahead of the local clock", () => {
    const ahead: TokenBucketState = { tokens: 100, lastRefill: T0 + HOUR };
    const { state } = tokenBucket(ahead, config, T0, 0);
    expect(state.tokens).toBe(100);
    expect(state.lastRefill).toBe(T0 + HOUR);
  });

  it("treats cost 0 as a peek that still applies refill", () => {
    const state: TokenBucketState = { tokens: 0, lastRefill: T0 };
    const { response } = tokenBucket(state, config, T0 + HOUR, 0);
    expect(response.success).toBe(true);
    expect(response.remaining).toBe(1000);
  });

  it("never mutates the input state", () => {
    const input = Object.freeze({ tokens: 1000, lastRefill: T0 });
    const { state } = tokenBucket(input, config, T0 + 1, 10);
    expect(input).toEqual({ tokens: 1000, lastRefill: T0 });
    expect(state).not.toBe(input);
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid cost %p", (cost) => {
    expect(() => tokenBucket(null, config, T0, cost)).toThrow(LymitConfigError);
  });

  it("property: total spend over random traffic never exceeds capacity plus refill", () => {
    // Deterministic LCG so the test is reproducible.
    let seed = 42;
    const rand = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32) / 2 ** 32;

    const fast: ResolvedTokenBucketConfig = {
      algorithm: "tokenBucket",
      capacity: 100,
      refillRate: 10,
      intervalMs: 1_000,
    };
    let state: TokenBucketState | null = null;
    let now = T0;
    let spent = 0;
    for (let i = 0; i < 5_000; i++) {
      now += Math.floor(rand() * 300);
      const cost = Math.floor(rand() * 30);
      const r = tokenBucket(state, fast, now, cost);
      if (r.response.success) spent += cost;
      expect(r.state.tokens).toBeGreaterThanOrEqual(0);
      expect(r.state.tokens).toBeLessThanOrEqual(fast.capacity);
      state = r.state;
    }
    const maxPossible = fast.capacity + ((now - T0) / fast.intervalMs) * fast.refillRate;
    expect(spent).toBeLessThanOrEqual(maxPossible);
    // And it is not trivially passing because everything was rejected.
    expect(spent).toBeGreaterThan(fast.capacity);
  });
});
