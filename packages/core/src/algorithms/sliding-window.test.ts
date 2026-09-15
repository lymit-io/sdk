import { describe, expect, it } from "vitest";
import { LymitConfigError } from "../errors.js";
import type { ResolvedSlidingWindowConfig } from "../types.js";
import { slidingWindow, type SlidingWindowState } from "./sliding-window.js";

const config: ResolvedSlidingWindowConfig = {
  algorithm: "slidingWindow",
  limit: 10,
  windowMs: 60_000,
};
const W = 60_000;
// Epoch-aligned minute boundaries.
const T0 = 1_700_000_040_000; // window N
const T1 = T0 + W; // window N+1
const T2 = T1 + W; // window N+2

const full: SlidingWindowState = { windowStart: T0, currentCount: 10, previousCount: 0 };

describe("slidingWindow", () => {
  it("allows the first request and opens an epoch-aligned window", () => {
    const { state, response } = slidingWindow(null, config, T0 + 5_000);
    expect(state).toEqual<SlidingWindowState>({
      windowStart: T0,
      currentCount: 1,
      previousCount: 0,
    });
    expect(response).toEqual({ success: true, limit: 10, remaining: 9, reset: T1 });
  });

  it("behaves like a fixed window within a single window with no history", () => {
    let state: SlidingWindowState | null = null;
    for (let i = 1; i <= 10; i++) {
      const r = slidingWindow(state, config, T0 + i);
      expect(r.response.success).toBe(true);
      expect(r.response.remaining).toBe(10 - i);
      state = r.state;
    }
    const rejected = slidingWindow(state, config, T0 + 11);
    expect(rejected.response.success).toBe(false);
    expect(rejected.response.remaining).toBe(0);
    expect(rejected.state.currentCount).toBe(10);
  });

  it("carries the current count into previousCount when the window rolls", () => {
    const { state } = slidingWindow(full, config, T1);
    expect(state.windowStart).toBe(T1);
    expect(state.previousCount).toBe(10);
  });

  it("still blocks a burst from the end of window N at the very start of N+1", () => {
    // At elapsedFraction = 0 the previous window is weighted at 100%.
    const { response } = slidingWindow(full, config, T1);
    expect(response.success).toBe(false);
    expect(response.remaining).toBe(0);
  });

  it("smoothly releases capacity as the window elapses", () => {
    // 50% in: weighted = 10 * 0.5 + 0 = 5, so exactly 5 more fit.
    const half = T1 + W / 2;
    let state: SlidingWindowState | null = full;
    for (let i = 1; i <= 5; i++) {
      const r = slidingWindow(state, config, half);
      expect(r.response.success).toBe(true);
      expect(r.response.remaining).toBe(5 - i);
      state = r.state;
    }
    expect(slidingWindow(state, config, half).response.success).toBe(false);
  });

  it("has full capacity again just before the next boundary", () => {
    const { response } = slidingWindow(full, config, T2 - 1);
    expect(response.success).toBe(true);
    // 10 * (1/60000) weight ≈ 0.0002, floor(10 - 1 - 0.0002) = 8
    expect(response.remaining).toBe(8);
  });

  it("reports remaining rounded down so it never over-promises", () => {
    // 25% in: weighted = 7.5. After one request, 8.5 used -> remaining floor(1.5) = 1.
    const { response } = slidingWindow(full, config, T1 + W / 4);
    expect(response.remaining).toBe(1);
  });

  it("forgets history entirely after two or more idle windows", () => {
    const { state, response } = slidingWindow(full, config, T2 + 1);
    expect(state).toEqual({ windowStart: T2, currentCount: 1, previousCount: 0 });
    expect(response.remaining).toBe(9);
  });

  it("deducts cost > 1 and rejects a cost that no longer fits without consuming", () => {
    const first = slidingWindow(null, config, T0, 6);
    expect(first.state.currentCount).toBe(6);
    expect(first.response.remaining).toBe(4);
    const second = slidingWindow(first.state, config, T0, 5);
    expect(second.response.success).toBe(false);
    expect(second.state.currentCount).toBe(6);
    expect(second.response.remaining).toBe(4);
  });

  it("rejects a cost larger than the limit without consuming", () => {
    const { state, response } = slidingWindow(null, config, T0, 11);
    expect(response.success).toBe(false);
    expect(state.currentCount).toBe(0);
    expect(response.remaining).toBe(10);
  });

  it("treats cost 0 as a peek", () => {
    const { state, response } = slidingWindow(full, config, T0, 0);
    expect(response.success).toBe(true);
    expect(state).toEqual(full);
  });

  describe("retryAfter", () => {
    it("is the exact moment enough previous-window weight has decayed", () => {
      // previous=10, current=0, cost=1: need 10*(1-f) + 1 <= 10  ->  f >= 0.1  ->  6s in.
      const { response } = slidingWindow(full, config, T1);
      expect(response.retryAfter).toBe(6_000);
      expect(response.reset).toBe(T2);
      // Sanity: at exactly that moment the request succeeds.
      expect(slidingWindow(full, config, T1 + 6_000).response.success).toBe(true);
    });

    it("waits for the boundary when the current window alone is already full", () => {
      const state: SlidingWindowState = { windowStart: T1, currentCount: 10, previousCount: 3 };
      const { response } = slidingWindow(state, config, T1 + 1_000);
      expect(response.success).toBe(false);
      expect(response.retryAfter).toBe(W - 1_000);
    });

    it("is absent on success", () => {
      expect(slidingWindow(null, config, T0).response).not.toHaveProperty("retryAfter");
    });
  });

  it("honours a stored window ahead of the local clock instead of resetting", () => {
    const ahead: SlidingWindowState = { windowStart: T1, currentCount: 10, previousCount: 10 };
    const { state, response } = slidingWindow(ahead, config, T1 - 1_000);
    expect(state).toEqual(ahead);
    expect(response.success).toBe(false);
    expect(response.reset).toBe(T2);
  });

  it("never mutates the input state", () => {
    const input = Object.freeze({ windowStart: T0, currentCount: 2, previousCount: 3 });
    const { state } = slidingWindow(input, config, T0 + 1);
    expect(input).toEqual({ windowStart: T0, currentCount: 2, previousCount: 3 });
    expect(state).not.toBe(input);
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid cost %p", (cost) => {
    expect(() => slidingWindow(null, config, T0, cost)).toThrow(LymitConfigError);
  });
});
