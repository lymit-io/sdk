import { fixedWindowSettle } from "./algorithms/fixed-window.js";
import { slidingWindowSettle } from "./algorithms/sliding-window.js";
import { tokenBucketSettle } from "./algorithms/token-bucket.js";
import { isStateFor, type LimitState } from "./apply.js";
import { LymitConfigError } from "./errors.js";
import type { AlgorithmResult, ResolvedLimitConfig } from "./types.js";

/** Validate a settle `delta`: any safe integer. Positive charges more, negative refunds. */
export function assertDelta(delta: number): number {
  if (!Number.isSafeInteger(delta)) {
    throw new LymitConfigError(`Invalid delta ${String(delta)}: must be a safe integer`);
  }
  return delta;
}

/**
 * Settle a call whose real cost is known only after it ran — an LLM response's token usage.
 * Reserve with `applyLimit(…, estimate)` before the call, then settle `actual - estimate`
 * after it. A settle always applies (the cost was incurred whether or not it fits), so it
 * never rejects and may leave a token bucket in debt; see each algorithm's settle function.
 *
 * A stored state that does not match the configured algorithm is treated as absent, as in
 * `applyLimit`.
 */
export function settleLimit(
  state: unknown,
  config: ResolvedLimitConfig,
  now: number,
  delta: number,
): AlgorithmResult<LimitState> {
  assertDelta(delta);
  switch (config.algorithm) {
    case "fixedWindow":
      return fixedWindowSettle(isStateFor("fixedWindow", state) ? state : null, config, now, delta);
    case "slidingWindow":
      return slidingWindowSettle(
        isStateFor("slidingWindow", state) ? state : null,
        config,
        now,
        delta,
      );
    case "tokenBucket":
      return tokenBucketSettle(isStateFor("tokenBucket", state) ? state : null, config, now, delta);
    default: {
      const { algorithm } = config as { algorithm: unknown };
      throw new LymitConfigError(`Unknown algorithm ${String(algorithm)}`);
    }
  }
}
