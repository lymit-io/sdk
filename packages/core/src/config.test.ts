import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";
import { LymitConfigError } from "./errors.js";

describe("resolveConfig", () => {
  it("resolves a fixed window config to milliseconds", () => {
    expect(resolveConfig({ algorithm: "fixedWindow", limit: 100, window: "1m" })).toEqual({
      algorithm: "fixedWindow",
      limit: 100,
      windowMs: 60_000,
    });
  });

  it("resolves a sliding window config to milliseconds", () => {
    expect(resolveConfig({ algorithm: "slidingWindow", limit: 10, window: 5_000 })).toEqual({
      algorithm: "slidingWindow",
      limit: 10,
      windowMs: 5_000,
    });
  });

  it("resolves a token bucket config to milliseconds", () => {
    expect(
      resolveConfig({ algorithm: "tokenBucket", capacity: 5000, refillRate: 1000, interval: "1h" }),
    ).toEqual({
      algorithm: "tokenBucket",
      capacity: 5000,
      refillRate: 1000,
      intervalMs: 3_600_000,
    });
  });

  it("does not mutate the input", () => {
    const input = { algorithm: "fixedWindow", limit: 1, window: "1s" } as const;
    const frozen = Object.freeze({ ...input });
    resolveConfig(frozen);
    expect(frozen).toEqual(input);
  });

  it("rejects an unknown algorithm", () => {
    expect(() => resolveConfig({ algorithm: "leakyBucket" } as never)).toThrow(LymitConfigError);
    expect(() => resolveConfig({ algorithm: "leakyBucket" } as never)).toThrow(/leakyBucket/);
  });

  it("rejects non-object config", () => {
    expect(() => resolveConfig(undefined as never)).toThrow(LymitConfigError);
    expect(() => resolveConfig("tokenBucket" as never)).toThrow(LymitConfigError);
  });

  it.each([0, -1, 1.5, Number.NaN, "10", undefined])("rejects window limit %p", (limit) => {
    expect(() => resolveConfig({ algorithm: "fixedWindow", limit, window: "1m" } as never)).toThrow(
      LymitConfigError,
    );
    expect(() => resolveConfig({ algorithm: "fixedWindow", limit, window: "1m" } as never)).toThrow(
      /limit/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, undefined])("rejects token bucket capacity %p", (capacity) => {
    expect(() =>
      resolveConfig({ algorithm: "tokenBucket", capacity, refillRate: 1, interval: "1s" } as never),
    ).toThrow(/capacity/);
  });

  it.each([0, -1, Number.NaN, undefined])("rejects token bucket refillRate %p", (refillRate) => {
    expect(() =>
      resolveConfig({
        algorithm: "tokenBucket",
        capacity: 10,
        refillRate,
        interval: "1s",
      } as never),
    ).toThrow(/refillRate/);
  });

  it("allows a fractional refillRate (tokens per interval need not be whole)", () => {
    expect(
      resolveConfig({ algorithm: "tokenBucket", capacity: 10, refillRate: 0.5, interval: "1s" }),
    ).toMatchObject({ refillRate: 0.5 });
  });

  it("surfaces duration errors with the field name", () => {
    expect(() =>
      resolveConfig({ algorithm: "fixedWindow", limit: 1, window: "1x" } as never),
    ).toThrow(/window/);
    expect(() =>
      resolveConfig({
        algorithm: "tokenBucket",
        capacity: 1,
        refillRate: 1,
        interval: "0s",
      } as never),
    ).toThrow(/interval/);
  });
});
