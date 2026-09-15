/** A duration as milliseconds, or a short human string like `"30s"`, `"10m"`, `"1h"`, `"1d"`. */
export type Duration = number | DurationString;

export type DurationUnit = "ms" | "s" | "m" | "h" | "d";
export type DurationString = `${number}${DurationUnit}`;

/**
 * User-facing limit configuration, as passed to `namespace(name, config)`.
 * Discriminated on `algorithm` so each variant only exposes the fields it needs.
 */
export type LimitConfig = FixedWindowConfig | SlidingWindowConfig | TokenBucketConfig;

export type Algorithm = LimitConfig["algorithm"];

/** Allow at most `limit` units of cost per fixed window of `window`. Windows align to epoch. */
export interface FixedWindowConfig {
  algorithm: "fixedWindow";
  limit: number;
  window: Duration;
}

/** Like fixedWindow but smoothed across the boundary using the previous window's weighted count. */
export interface SlidingWindowConfig {
  algorithm: "slidingWindow";
  limit: number;
  window: Duration;
}

/**
 * A bucket holding up to `capacity` tokens that refills by `refillRate` tokens every `interval`.
 * Each call deducts `cost` tokens (default 1). This is the algorithm for AI budget control.
 */
export interface TokenBucketConfig {
  algorithm: "tokenBucket";
  capacity: number;
  refillRate: number;
  interval: Duration;
}

/**
 * Configuration after validation, with every duration converted to milliseconds.
 * Algorithms only ever receive this shape, so they never re-validate.
 */
export type ResolvedLimitConfig =
  ResolvedFixedWindowConfig | ResolvedSlidingWindowConfig | ResolvedTokenBucketConfig;

export interface ResolvedFixedWindowConfig {
  algorithm: "fixedWindow";
  limit: number;
  windowMs: number;
}

export interface ResolvedSlidingWindowConfig {
  algorithm: "slidingWindow";
  limit: number;
  windowMs: number;
}

export interface ResolvedTokenBucketConfig {
  algorithm: "tokenBucket";
  capacity: number;
  refillRate: number;
  intervalMs: number;
}

/** The result of a single `limit()` call. Mirrors the shape of standard rate-limit headers. */
export interface LimitResponse {
  /** Whether the request is allowed. */
  success: boolean;
  /** The effective ceiling: window `limit` or bucket `capacity`. */
  limit: number;
  /** Units of cost still available after this call (never negative). */
  remaining: number;
  /**
   * Unix timestamp in milliseconds. For windows: when the window resets. For token
   * buckets: when enough tokens will have refilled to afford the requested cost.
   */
  reset: number;
  /** Milliseconds until a retry could succeed. Present only when `success` is false. */
  retryAfter?: number;
}

/** What every algorithm returns: the next state to persist, plus the response for the caller. */
export interface AlgorithmResult<State> {
  state: State;
  response: LimitResponse;
}
