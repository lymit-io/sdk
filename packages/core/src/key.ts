import { LymitConfigError } from "./errors.js";

/**
 * ASCII unit separator. It exists precisely to delimit fields, is invisible, and appears in
 * no real-world identifier (user IDs, emails, tier names, IPs), so it can be forbidden in
 * every part of the key without inconveniencing anyone.
 */
export const KEY_SEPARATOR = String.fromCodePoint(0x1f);

/** Generous enough for a UUID, an email, or a composite id; small enough to index comfortably. */
export const MAX_IDENTIFIER_LENGTH = 256;

/**
 * Build the storage/cache key for a counter. Injective: because the separator cannot occur
 * in any part, distinct `(workspace, namespace, identifier)` triples never collide.
 */
export function keyFor(workspaceId: string, namespace: string, identifier: string): string {
  return [
    assertIdentifier(workspaceId, "workspaceId"),
    assertIdentifier(namespace, "namespace"),
    assertIdentifier(identifier, "identifier"),
  ].join(KEY_SEPARATOR);
}

/** Validate one key part: a non-empty string, within length, not containing the separator. */
export function assertIdentifier(value: string, field = "identifier"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LymitConfigError(`Invalid ${field}: must be a non-empty string`);
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new LymitConfigError(
      `Invalid ${field}: must be at most ${String(MAX_IDENTIFIER_LENGTH)} characters, got ${String(value.length)}`,
    );
  }
  if (value.includes(KEY_SEPARATOR)) {
    throw new LymitConfigError(`Invalid ${field}: must not contain the unit separator (U+001F)`);
  }
  return value;
}
