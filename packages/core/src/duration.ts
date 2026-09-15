import { LymitConfigError } from "./errors.js";
import type { Duration, DurationUnit } from "./types.js";

const UNIT_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/;

/**
 * Convert a `Duration` to a positive whole number of milliseconds.
 *
 * Numbers are taken as milliseconds. Strings are `<value><unit>` where unit is one of
 * `ms`, `s`, `m`, `h`, `d`; the value may be fractional as long as the result is a whole
 * millisecond (`"1.5h"` is fine, `"1.5ms"` is not).
 */
export function parseDuration(input: Duration): number {
  if (typeof input === "number") {
    return assertPositiveIntegerMs(input, input);
  }
  if (typeof input !== "string") {
    throw new LymitConfigError(`Invalid duration ${describe(input)}: expected a number or string`);
  }

  const match = DURATION_PATTERN.exec(input);
  const value = match?.[1];
  const unit = match?.[2] as DurationUnit | undefined;
  if (value === undefined || unit === undefined) {
    throw new LymitConfigError(
      `Invalid duration "${input}": expected a value followed by ms, s, m, h or d (e.g. "30s", "1h")`,
    );
  }

  return assertPositiveIntegerMs(Number(value) * UNIT_MS[unit], input);
}

function assertPositiveIntegerMs(ms: number, original: Duration): number {
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new LymitConfigError(
      `Invalid duration ${describe(original)}: must be a positive whole number of milliseconds`,
    );
  }
  return ms;
}

function describe(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}
