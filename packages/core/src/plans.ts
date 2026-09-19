import type { Algorithm } from "./types.js";

export type Plan = "hobby" | "pro" | "enterprise";

export interface PlanEntitlements {
  /**
   * Algorithms the plan may use; others are rejected with `feature_not_in_plan`. Every plan
   * has all three (founder decision Q2, 2026-09-18): the token bucket is the product, so
   * Hobby is capped in volume, not capability. The gate stays for future paid features.
   */
  algorithms: readonly Algorithm[];
  /** Whether workspace namespace config and dashboard rules are applied at the edge. */
  overrides: boolean;
  /** Request quota, one of the two. Enforced in the Edge API (task 3.9). */
  requestsPerDay?: number;
  requestsPerMonth?: number;
  /** Abuse ceiling on the Edge API itself: requests per UTC minute per workspace. */
  burstPerMinute: number;
  /** Event retention for analytics. */
  retentionDays: number;
}

/**
 * Single source of truth for what each plan may do (business plan §7). Imported by the
 * Edge API for gating and by the dashboard for display, so the two can never disagree.
 */
export const PLANS: Record<Plan, PlanEntitlements> = {
  hobby: {
    algorithms: ["fixedWindow", "slidingWindow", "tokenBucket"],
    overrides: false,
    requestsPerDay: 10_000,
    burstPerMinute: 1_200,
    retentionDays: 7,
  },
  pro: {
    algorithms: ["fixedWindow", "slidingWindow", "tokenBucket"],
    overrides: true,
    requestsPerMonth: 1_000_000,
    burstPerMinute: 6_000,
    retentionDays: 30,
  },
  enterprise: {
    algorithms: ["fixedWindow", "slidingWindow", "tokenBucket"],
    overrides: true,
    burstPerMinute: 60_000,
    retentionDays: 90,
  },
};

export function isPlan(value: unknown): value is Plan {
  return value === "hobby" || value === "pro" || value === "enterprise";
}
