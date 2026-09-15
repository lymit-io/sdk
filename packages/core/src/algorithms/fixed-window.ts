import { assertCost } from "../cost.js";
import type { AlgorithmResult, ResolvedFixedWindowConfig } from "../types.js";

export interface FixedWindowState {
  /** Epoch-aligned start of the window this count belongs to (Unix ms). */
  windowStart: number;
  /** Cost consumed so far in that window. */
  count: number;
}

/**
 * Fixed window: allow up to `limit` cost per window of `windowMs`. Windows are aligned to
 * the Unix epoch, so every node derives identical boundaries with no coordination.
 *
 * Pure: never mutates `state`; the returned state must be persisted by the caller.
 */
export function fixedWindow(
  state: FixedWindowState | null,
  config: ResolvedFixedWindowConfig,
  now: number,
  cost = 1,
): AlgorithmResult<FixedWindowState> {
  assertCost(cost);
  const { limit, windowMs } = config;

  const current = currentWindow(state, now, windowMs);
  const success = current.count + cost <= limit;
  const count = success ? current.count + cost : current.count;
  const reset = current.windowStart + windowMs;

  return {
    state: { windowStart: current.windowStart, count },
    response: {
      success,
      limit,
      remaining: Math.max(0, limit - count),
      reset,
      ...(success ? {} : { retryAfter: Math.max(0, reset - now) }),
    },
  };
}

function currentWindow(
  state: FixedWindowState | null,
  now: number,
  windowMs: number,
): FixedWindowState {
  const localStart = now - (now % windowMs);
  // A stored window at or ahead of ours is still live: either it is the same window, or
  // another node with a faster clock has already moved on. Never hand out a fresh
  // allowance in that case; only a window strictly in the past rolls over.
  if (state !== null && state.windowStart >= localStart) {
    return state;
  }
  return { windowStart: localStart, count: 0 };
}
