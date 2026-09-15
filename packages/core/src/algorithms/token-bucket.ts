import { assertCost } from "../cost.js";
import type { AlgorithmResult, ResolvedTokenBucketConfig } from "../types.js";

export interface TokenBucketState {
  /** Tokens available as of `lastRefill`. May be fractional between refill ticks. */
  tokens: number;
  /** Unix ms of the last time refill was applied. */
  lastRefill: number;
}

/**
 * Token bucket with per-call cost — the algorithm for AI budget control.
 *
 * The bucket holds up to `capacity` tokens and refills continuously at
 * `refillRate / intervalMs` tokens per ms. Refill is applied lazily on each call from the
 * elapsed time, so no background timer is needed and idle keys cost nothing. A call
 * succeeds only if the full `cost` is available; partial deductions never happen.
 *
 * Pure: never mutates `state`.
 */
export function tokenBucket(
  state: TokenBucketState | null,
  config: ResolvedTokenBucketConfig,
  now: number,
  cost = 1,
): AlgorithmResult<TokenBucketState> {
  assertCost(cost);
  const { capacity, refillRate, intervalMs } = config;
  const tokensPerMs = refillRate / intervalMs;

  const refilled = refill(state, capacity, tokensPerMs, now);
  const success = cost <= refilled.tokens;
  const tokens = success ? refilled.tokens - cost : refilled.tokens;

  return {
    state: { tokens, lastRefill: refilled.lastRefill },
    response: {
      success,
      limit: capacity,
      remaining: Math.floor(tokens),
      ...resetFields(success, cost, capacity, tokens, tokensPerMs, now),
    },
  };
}

function refill(
  state: TokenBucketState | null,
  capacity: number,
  tokensPerMs: number,
  now: number,
): TokenBucketState {
  if (state === null) {
    return { tokens: capacity, lastRefill: now };
  }
  // A lastRefill ahead of our clock means another node was faster; do not "un-refill".
  const elapsed = Math.max(0, now - state.lastRefill);
  return {
    tokens: Math.min(capacity, state.tokens + elapsed * tokensPerMs),
    lastRefill: Math.max(state.lastRefill, now),
  };
}

/**
 * `reset` is when the bucket is next in a "good" state: full again after a success, or
 * able to afford `cost` after a rejection. `retryAfter` accompanies rejections only, and
 * is omitted when the cost can never be afforded (cost > capacity) so callers do not wait
 * for something that will not happen.
 */
function resetFields(
  success: boolean,
  cost: number,
  capacity: number,
  tokens: number,
  tokensPerMs: number,
  now: number,
): { reset: number; retryAfter?: number } {
  if (success) {
    return { reset: now + msUntil(capacity - tokens, tokensPerMs) };
  }
  if (cost > capacity) {
    return { reset: now };
  }
  const wait = msUntil(cost - tokens, tokensPerMs);
  return { reset: now + wait, retryAfter: wait };
}

/** Whole milliseconds until `deficit` tokens have refilled, rounded up so a retry then succeeds. */
function msUntil(deficit: number, tokensPerMs: number): number {
  return deficit <= 0 ? 0 : Math.ceil(deficit / tokensPerMs);
}
