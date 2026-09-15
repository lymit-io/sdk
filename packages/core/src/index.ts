export { parseDuration } from "./duration.js";
export { resolveConfig } from "./config.js";
export { LymitConfigError } from "./errors.js";
export { assertCost } from "./cost.js";
export { fixedWindow, type FixedWindowState } from "./algorithms/fixed-window.js";
export type {
  Algorithm,
  AlgorithmResult,
  Duration,
  DurationString,
  DurationUnit,
  FixedWindowConfig,
  LimitConfig,
  LimitResponse,
  ResolvedFixedWindowConfig,
  ResolvedLimitConfig,
  ResolvedSlidingWindowConfig,
  ResolvedTokenBucketConfig,
  SlidingWindowConfig,
  TokenBucketConfig,
} from "./types.js";
