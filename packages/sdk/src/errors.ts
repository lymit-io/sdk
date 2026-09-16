/** Error codes returned by the Edge API (see docs/architecture/api-contract.md). */
export type LymitErrorCode =
  | "bad_request"
  | "invalid_api_key"
  | "quota_exceeded"
  | "feature_not_in_plan"
  | "not_found"
  | "internal"
  | "network_error"
  | "timeout";

/**
 * A failure talking to Lymit — as opposed to a rate-limit *rejection*, which is a normal
 * `LimitResponse` with `success: false`. Whether this reaches your code depends on
 * `failMode` (task 4.3); by default the SDK fails open and reports it via `onError`.
 */
export class LymitError extends Error {
  override readonly name = "LymitError";
  readonly code: LymitErrorCode;
  /** HTTP status when the server answered; undefined for network errors and timeouts. */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { code: LymitErrorCode; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.status = options.status;
  }
}
