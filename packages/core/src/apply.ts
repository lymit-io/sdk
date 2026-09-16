import { fixedWindow, type FixedWindowState } from "./algorithms/fixed-window.js";
import { slidingWindow, type SlidingWindowState } from "./algorithms/sliding-window.js";
import { tokenBucket, type TokenBucketState } from "./algorithms/token-bucket.js";
import { LymitConfigError } from "./errors.js";
import type { Algorithm, AlgorithmResult, ResolvedLimitConfig } from "./types.js";

/** Persisted state for any algorithm. Storage backends round-trip this opaquely. */
export type LimitState = FixedWindowState | SlidingWindowState | TokenBucketState;

/**
 * Run the algorithm named by `config` against `state`. This is the single entry point
 * every storage backend uses, so the algorithm `switch` lives in exactly one place.
 *
 * A stored state that does not match the configured algorithm (the developer changed a
 * namespace from `fixedWindow` to `tokenBucket`, say) or is otherwise malformed is treated
 * as absent: the key simply starts fresh under the new rules.
 */
export function applyLimit(
  state: unknown,
  config: ResolvedLimitConfig,
  now: number,
  cost = 1,
): AlgorithmResult<LimitState> {
  switch (config.algorithm) {
    case "fixedWindow":
      return fixedWindow(isStateFor("fixedWindow", state) ? state : null, config, now, cost);
    case "slidingWindow":
      return slidingWindow(isStateFor("slidingWindow", state) ? state : null, config, now, cost);
    case "tokenBucket":
      return tokenBucket(isStateFor("tokenBucket", state) ? state : null, config, now, cost);
    default: {
      const { algorithm } = config as { algorithm: unknown };
      throw new LymitConfigError(`Unknown algorithm ${String(algorithm)}`);
    }
  }
}

interface StateShapes {
  fixedWindow: FixedWindowState;
  slidingWindow: SlidingWindowState;
  tokenBucket: TokenBucketState;
}

const STATE_FIELDS: Record<Algorithm, readonly string[]> = {
  fixedWindow: ["windowStart", "count"],
  slidingWindow: ["windowStart", "currentCount", "previousCount"],
  tokenBucket: ["tokens", "lastRefill"],
};

/** Structural check that `value` is exactly the state shape for `algorithm` (all numeric fields, no extras). */
export function isStateFor<A extends Algorithm>(
  algorithm: A,
  value: unknown,
): value is StateShapes[A] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const fields = STATE_FIELDS[algorithm];
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === fields.length &&
    fields.every((field) => typeof record[field] === "number")
  );
}
