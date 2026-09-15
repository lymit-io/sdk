import { describe, expect, it } from "vitest";
import { parseDuration } from "./duration.js";
import { LymitConfigError } from "./errors.js";
import type { Duration } from "./types.js";

describe("parseDuration", () => {
  it("passes numbers through as milliseconds", () => {
    expect(parseDuration(1)).toBe(1);
    expect(parseDuration(1500)).toBe(1500);
  });

  it.each([
    ["500ms", 500],
    ["1s", 1_000],
    ["30s", 30_000],
    ["1m", 60_000],
    ["10m", 600_000],
    ["1h", 3_600_000],
    ["24h", 86_400_000],
    ["1d", 86_400_000],
    ["7d", 604_800_000],
  ] as const)("parses %s as %i ms", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it("accepts fractional values as long as the result is a whole millisecond", () => {
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("0.5s")).toBe(500);
  });

  it("tolerates whitespace at runtime (for untyped JS callers; the type stays strict)", () => {
    expect(parseDuration(" 1h " as Duration)).toBe(3_600_000);
    expect(parseDuration("10 m")).toBe(600_000);
  });

  it.each([
    ["", "empty"],
    ["1", "missing unit"],
    ["h", "missing value"],
    ["1x", "unknown unit"],
    ["1hr", "unknown unit"],
    ["-1h", "negative"],
    ["0s", "zero"],
    ["1.5ms", "fractional millisecond"],
    ["abc", "garbage"],
  ])("rejects %j (%s)", (input) => {
    expect(() => parseDuration(input as never)).toThrow(LymitConfigError);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive-integer number %p",
    (input) => {
      expect(() => parseDuration(input)).toThrow(LymitConfigError);
    },
  );

  it("rejects non-string, non-number input", () => {
    expect(() => parseDuration(null as never)).toThrow(LymitConfigError);
    expect(() => parseDuration({} as never)).toThrow(LymitConfigError);
  });

  it("names the offending input in the error message", () => {
    expect(() => parseDuration("1x" as never)).toThrow(/"1x"/);
  });
});
