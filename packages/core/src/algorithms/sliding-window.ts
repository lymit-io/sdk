import { assertCost } from "../cost.js";
import type { AlgorithmResult, ResolvedSlidingWindowConfig } from "../types.js";

export interface SlidingWindowState {
  /** Epoch-aligned start of the current window (Unix ms). */
  windowStart: number;
  /** Cost consumed in the current window. */
  currentCount: number;
  /** Cost consumed in the window immediately before `windowStart`. */
  previousCount: number;
}

/**
 * Sliding window, weighted two-window approximation.
 *
 * Rather than keeping a log of every request (a row per hit), we keep two counters and
 * estimate the trailing-window usage as `previous * (1 - elapsedFraction) + current`. This
 * assumes the previous window's requests were spread evenly, which is accurate enough for
 * rate limiting and keeps state O(1) per key so a single row update suffices at the edge.
 *
 * Pure: never mutates `state`.
 */
export function slidingWindow(
  state: SlidingWindowState | null,
  config: ResolvedSlidingWindowConfig,
  now: number,
  cost = 1,
): AlgorithmResult<SlidingWindowState> {
  assertCost(cost);
  const { limit, windowMs } = config;

  const current = currentWindow(state, now, windowMs);
  const elapsed = clamp((now - current.windowStart) / windowMs, 0, 1);
  const previousWeight = 1 - elapsed;
  const used = current.previousCount * previousWeight + current.currentCount;

  const success = used + cost <= limit;
  const currentCount = success ? current.currentCount + cost : current.currentCount;
  const usedAfter = success ? used + cost : used;
  const reset = current.windowStart + windowMs;

  return {
    state: { ...current, currentCount },
    response: {
      success,
      limit,
      remaining: Math.max(0, Math.floor(limit - usedAfter)),
      reset,
      ...(success ? {} : { retryAfter: retryAfter(current, cost, limit, windowMs, now) }),
    },
  };
}

function currentWindow(
  state: SlidingWindowState | null,
  now: number,
  windowMs: number,
): SlidingWindowState {
  const localStart = now - (now % windowMs);
  if (state === null) {
    return { windowStart: localStart, currentCount: 0, previousCount: 0 };
  }
  // Same window, or a node with a faster clock already moved on: keep as is (see fixedWindow).
  if (state.windowStart >= localStart) {
    return state;
  }
  // Rolled by exactly one window: the old current becomes the new previous.
  if (state.windowStart === localStart - windowMs) {
    return { windowStart: localStart, currentCount: 0, previousCount: state.currentCount };
  }
  // Idle for two or more windows: nothing left to weight.
  return { windowStart: localStart, currentCount: 0, previousCount: 0 };
}

/**
 * Milliseconds until `cost` could fit. Solve `previous * (1 - f) + current + cost <= limit`
 * for the elapsed fraction `f`; if the current window alone already cannot fit the cost,
 * the earliest possible retry is the next boundary.
 */
function retryAfter(
  { windowStart, currentCount, previousCount }: SlidingWindowState,
  cost: number,
  limit: number,
  windowMs: number,
  now: number,
): number {
  const boundary = windowStart + windowMs - now;
  const headroom = limit - currentCount - cost;
  if (headroom < 0 || previousCount === 0) {
    return Math.max(0, boundary);
  }
  const requiredFraction = 1 - headroom / previousCount;
  const readyAt = windowStart + Math.ceil(requiredFraction * windowMs);
  return clamp(readyAt - now, 0, Math.max(0, boundary));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
