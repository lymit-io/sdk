import { describe, expect, it } from "vitest";
import { toHeaders } from "./headers.js";

describe("toHeaders", () => {
  it("emits the standard rate-limit headers with reset in whole seconds", () => {
    expect(
      toHeaders({ success: true, limit: 100, remaining: 42, reset: 1_700_000_000_500 }),
    ).toEqual({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": "1700000001",
    });
  });

  it("adds Retry-After in whole seconds, rounded up, on rejection", () => {
    expect(
      toHeaders({
        success: false,
        limit: 100,
        remaining: 0,
        reset: 1_700_000_000_000,
        retryAfter: 1_001,
      }),
    ).toMatchObject({ "Retry-After": "2" });
  });

  it("never emits Retry-After: 0 — a client retrying immediately would just be rejected again", () => {
    expect(
      toHeaders({
        success: false,
        limit: 1,
        remaining: 0,
        reset: 1_700_000_000_000,
        retryAfter: 0,
      }),
    ).toMatchObject({ "Retry-After": "1" });
  });

  it("omits Retry-After when the rejection is not retryable", () => {
    expect(
      toHeaders({ success: false, limit: 1, remaining: 0, reset: 1_700_000_000_000 }),
    ).not.toHaveProperty("Retry-After");
  });
});
