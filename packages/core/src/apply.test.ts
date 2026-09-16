import { describe, expect, it } from "vitest";
import { applyLimit, isStateFor } from "./apply.js";
import type { ResolvedLimitConfig } from "./types.js";

const T0 = 1_700_000_040_000;
const fixed: ResolvedLimitConfig = { algorithm: "fixedWindow", limit: 3, windowMs: 60_000 };
const sliding: ResolvedLimitConfig = { algorithm: "slidingWindow", limit: 3, windowMs: 60_000 };
const bucket: ResolvedLimitConfig = {
  algorithm: "tokenBucket",
  capacity: 10,
  refillRate: 1,
  intervalMs: 1_000,
};

describe("applyLimit", () => {
  it("dispatches to fixedWindow", () => {
    const { state, response } = applyLimit(null, fixed, T0, 2);
    expect(state).toEqual({ windowStart: T0, count: 2 });
    expect(response.remaining).toBe(1);
  });

  it("dispatches to slidingWindow", () => {
    const { state } = applyLimit(null, sliding, T0, 2);
    expect(state).toEqual({ windowStart: T0, currentCount: 2, previousCount: 0 });
  });

  it("dispatches to tokenBucket", () => {
    const { state } = applyLimit(null, bucket, T0, 4);
    expect(state).toEqual({ tokens: 6, lastRefill: T0 });
  });

  it("defaults cost to 1", () => {
    expect(applyLimit(null, fixed, T0).response.remaining).toBe(2);
  });

  it("starts fresh when the stored state belongs to a different algorithm (config changed)", () => {
    const bucketState = applyLimit(null, bucket, T0, 9).state;
    const { state, response } = applyLimit(bucketState, fixed, T0, 1);
    expect(state).toEqual({ windowStart: T0, count: 1 });
    expect(response.remaining).toBe(2);
  });

  it("starts fresh when the stored state is malformed", () => {
    const { response } = applyLimit({ garbage: true }, bucket, T0, 1);
    expect(response.remaining).toBe(9);
  });

  it("rejects an unknown algorithm at runtime", () => {
    expect(() => applyLimit(null, { algorithm: "nope" } as never, T0)).toThrow(/nope/);
  });
});

describe("isStateFor", () => {
  it("recognises each state shape", () => {
    expect(isStateFor("fixedWindow", { windowStart: 1, count: 0 })).toBe(true);
    expect(isStateFor("slidingWindow", { windowStart: 1, currentCount: 0, previousCount: 0 })).toBe(
      true,
    );
    expect(isStateFor("tokenBucket", { tokens: 1, lastRefill: 1 })).toBe(true);
  });

  it("rejects cross-shape and partial objects", () => {
    expect(isStateFor("fixedWindow", { windowStart: 1, currentCount: 0, previousCount: 0 })).toBe(
      false,
    );
    expect(isStateFor("slidingWindow", { windowStart: 1, count: 0 })).toBe(false);
    expect(isStateFor("tokenBucket", { tokens: 1 })).toBe(false);
    expect(isStateFor("tokenBucket", null)).toBe(false);
    expect(isStateFor("tokenBucket", { tokens: "1", lastRefill: 1 })).toBe(false);
  });
});
