import type { LimitResponse } from "./types.js";

export interface RateLimitHeaders {
  "X-RateLimit-Limit": string;
  "X-RateLimit-Remaining": string;
  /** Unix timestamp in whole seconds (the de-facto convention for this header). */
  "X-RateLimit-Reset": string;
  /** Whole seconds, rounded up, at least 1. Present only on retryable rejections. */
  "Retry-After"?: string;
}

/** Serialise a `LimitResponse` as the conventional HTTP rate-limit headers. */
export function toHeaders(response: LimitResponse): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    "X-RateLimit-Limit": String(response.limit),
    "X-RateLimit-Remaining": String(response.remaining),
    "X-RateLimit-Reset": String(Math.ceil(response.reset / 1_000)),
  };
  if (!response.success && response.retryAfter !== undefined) {
    // Never advertise 0: a client retrying immediately would just be rejected again.
    headers["Retry-After"] = String(Math.max(1, Math.ceil(response.retryAfter / 1_000)));
  }
  return headers;
}
