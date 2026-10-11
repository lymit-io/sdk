import { describe, expect, it } from "vitest";
import { applyLimit } from "./apply.js";
import { LymitConfigError } from "./errors.js";
import { assertDelta, settleLimit } from "./settle.js";
import type { ResolvedLimitConfig } from "./types.js";

const T0 = 1_700_000_040_000; // aligned to a minute
const fixed: ResolvedLimitConfig = { algorithm: "fixedWindow", limit: 100, windowMs: 60_000 };
const sliding: ResolvedLimitConfig = { algorithm: "slidingWindow", limit: 100, windowMs: 60_000 };
// 1000 tokens, refilling 1 per second.
const bucket: ResolvedLimitConfig = {
  algorithm: "tokenBucket",
  capacity: 1000,
  refillRate: 1,
  intervalMs: 1_000,
};

describe("settleLimit — tokenBucket", () => {
  it("charges the extra when actual usage exceeded the reservation", () => {
    const reserved = applyLimit(null, bucket, T0, 200).state; // 800 left
    const { state, response } = settleLimit(reserved, bucket, T0, 150);
    expect(state).toEqual({ tokens: 650, lastRefill: T0 });
    expect(response).toEqual({ success: true, limit: 1000, remaining: 650, reset: T0 + 350_000 });
  });

  it("refunds an over-estimate", () => {
    const reserved = applyLimit(null, bucket, T0, 500).state; // 500 left
    const { state, response } = settleLimit(reserved, bucket, T0, -300);
    expect(state).toMatchObject({ tokens: 800 });
    expect(response.remaining).toBe(800);
  });

  it("never refunds past capacity", () => {
    const reserved = applyLimit(null, bucket, T0, 10).state;
    expect(settleLimit(reserved, bucket, T0, -500).state).toMatchObject({ tokens: 1000 });
  });

  it("goes into debt instead of dropping the charge when the bucket is nearly empty", () => {
    // The abuse case: the user is at 50 tokens and the call really cost 400 more.
    const low = { tokens: 50, lastRefill: T0 };
    const { state, response } = settleLimit(low, bucket, T0, 400);
    expect(state).toMatchObject({ tokens: -350 });
    expect(response.success).toBe(true);
    expect(response.remaining).toBe(0);
    // Full again once 1350 tokens have refilled at 1/s.
    expect(response.reset).toBe(T0 + 1_350_000);
  });

  it("makes the next limit call wait out the debt", () => {
    const debt = settleLimit({ tokens: 0, lastRefill: T0 }, bucket, T0, 100).state; // -100
    const later = T0 + 50_000; // +50 refilled → -50
    const { response } = applyLimit(debt, bucket, later, 10);
    expect(response.success).toBe(false);
    expect(response.remaining).toBe(0);
    expect(response.retryAfter).toBe(60_000); // needs 60 more to afford 10
  });

  it("refills before settling, like a limit call", () => {
    const old = { tokens: 0, lastRefill: T0 };
    const { state } = settleLimit(old, bucket, T0 + 100_000, 30);
    expect(state).toEqual({ tokens: 70, lastRefill: T0 + 100_000 });
  });

  it("starts from a full bucket when there is no state", () => {
    expect(settleLimit(null, bucket, T0, 25).state).toMatchObject({ tokens: 975 });
  });
});

describe("settleLimit — fixedWindow", () => {
  it("adds the extra to the current window, even past the limit", () => {
    const used = applyLimit(null, fixed, T0, 90).state;
    const { state, response } = settleLimit(used, fixed, T0, 30);
    expect(state).toEqual({ windowStart: T0, count: 120 });
    expect(response).toEqual({ success: true, limit: 100, remaining: 0, reset: T0 + 60_000 });
    expect(applyLimit(state, fixed, T0, 1).response.success).toBe(false);
  });

  it("refunds into the current window, never below zero", () => {
    const used = applyLimit(null, fixed, T0, 20).state;
    expect(settleLimit(used, fixed, T0, -5).state).toMatchObject({ count: 15 });
    expect(settleLimit(used, fixed, T0, -50).state).toMatchObject({ count: 0 });
  });

  it("applies to the window the settle lands in, not a past one", () => {
    const used = applyLimit(null, fixed, T0, 80).state;
    const next = T0 + 60_000;
    expect(settleLimit(used, fixed, next, 10).state).toEqual({ windowStart: next, count: 10 });
  });
});

describe("settleLimit — slidingWindow", () => {
  it("adjusts the current window's count", () => {
    const used = applyLimit(null, sliding, T0, 40).state;
    const { state, response } = settleLimit(used, sliding, T0, 70);
    expect(state).toEqual({ windowStart: T0, currentCount: 110, previousCount: 0 });
    expect(response.remaining).toBe(0);
    expect(settleLimit(state, sliding, T0, -200).state).toMatchObject({ currentCount: 0 });
  });
});

describe("settleLimit — general", () => {
  it("is a no-op apart from refill when delta is 0", () => {
    const used = applyLimit(null, bucket, T0, 100).state;
    expect(settleLimit(used, bucket, T0, 0).state).toEqual(used);
  });

  it("treats state from another algorithm as absent", () => {
    const windowState = applyLimit(null, fixed, T0, 5).state;
    expect(settleLimit(windowState, bucket, T0, 10).state).toMatchObject({ tokens: 990 });
  });

  it("never mutates the state it is given", () => {
    const used = Object.freeze({ tokens: 10, lastRefill: T0 });
    expect(() => settleLimit(used, bucket, T0, 5)).not.toThrow();
  });
});

describe("assertDelta", () => {
  it.each([0, 1, -1, 5_000, -5_000])("accepts the integer %d", (delta) => {
    expect(assertDelta(delta)).toBe(delta);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])("rejects %d", (delta) => {
    expect(() => assertDelta(delta)).toThrow(LymitConfigError);
  });
});
