import { LymitConfigError } from "./errors.js";

/** Validate the `cost` of a single limit call: a non-negative integer (0 = peek without consuming). */
export function assertCost(cost: number): number {
  if (!Number.isInteger(cost) || cost < 0) {
    throw new LymitConfigError(`Invalid cost ${String(cost)}: must be a non-negative integer`);
  }
  return cost;
}
