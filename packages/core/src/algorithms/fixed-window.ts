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

/**
 * Settle a call after the fact: add `delta` to the current window's count, or refund
 * `-delta` from it. Always applies, so the count may pass `limit` (later calls in the window
 * are then rejected) but never drops below zero. A settle that lands in a later window than
 * its call adjusts the later one: the earlier window is gone and no longer limits anything.
 *
 * Pure: never mutates `state`.
 */
export function fixedWindowSettle(
  state: FixedWindowState | null,
  config: ResolvedFixedWindowConfig,
  now: number,
  delta: number,
): AlgorithmResult<FixedWindowState> {
  const { limit, windowMs } = config;
  const current = currentWindow(state, now, windowMs);
  const count = Math.max(0, current.count + delta);
  return {
    state: { windowStart: current.windowStart, count },
    response: {
      success: true,
      limit,
      remaining: Math.max(0, limit - count),
      reset: current.windowStart + windowMs,
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
