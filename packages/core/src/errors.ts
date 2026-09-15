/**
 * Thrown when a limit configuration is invalid. Always a programmer error at
 * the call site (typo, wrong unit, negative number), so the message names the
 * offending field and value to make the fix obvious.
 */
export class LymitConfigError extends Error {
  override readonly name = "LymitConfigError";
}
