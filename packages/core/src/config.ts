import { parseDuration } from "./duration.js";
import { LymitConfigError } from "./errors.js";
import type { Duration, LimitConfig, ResolvedLimitConfig } from "./types.js";

/**
 * Validate a user-supplied `LimitConfig` and convert it to a `ResolvedLimitConfig`
 * (durations in milliseconds). Throws `LymitConfigError` naming the bad field.
 * Never mutates the input.
 */
export function resolveConfig(config: LimitConfig): ResolvedLimitConfig {
  if (!isObject(config)) {
    throw new LymitConfigError(`Invalid limit config: expected an object, got ${String(config)}`);
  }

  switch (config.algorithm) {
    case "fixedWindow":
    case "slidingWindow":
      return {
        algorithm: config.algorithm,
        limit: positiveInteger("limit", config.limit),
        windowMs: duration("window", config.window),
      };
    case "tokenBucket":
      return {
        algorithm: "tokenBucket",
        capacity: positiveInteger("capacity", config.capacity),
        refillRate: positiveNumber("refillRate", config.refillRate),
        intervalMs: duration("interval", config.interval),
      };
    default: {
      const { algorithm } = config as { algorithm: unknown };
      throw new LymitConfigError(
        `Unknown algorithm ${String(algorithm)}: expected "fixedWindow", "slidingWindow" or "tokenBucket"`,
      );
    }
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function positiveInteger(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new LymitConfigError(`Invalid ${field} ${String(value)}: must be a positive integer`);
  }
  return value;
}

function positiveNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LymitConfigError(`Invalid ${field} ${String(value)}: must be a positive number`);
  }
  return value;
}

function duration(field: string, value: Duration): number {
  try {
    return parseDuration(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LymitConfigError(`Invalid ${field}: ${reason}`);
  }
}
