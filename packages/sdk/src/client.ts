import {
  assertCost,
  assertIdentifier,
  BlockCache,
  KEY_SEPARATOR,
  LymitConfigError,
  resolveConfig,
  type LimitConfig,
  type LimitResponse,
} from "@lymit/core";
import { LymitError, type LymitErrorCode } from "./errors.js";

export type FailMode = "open" | "closed";

export interface LymitOptions {
  /** Your workspace API key (`lym_live_…`). */
  apiKey: string;
  /** Edge API origin. Default `https://api.lymit.io`. */
  baseUrl?: string;
  /**
   * What to do when Lymit cannot answer: it is unreachable, returns a server error, or your
   * workspace is over its plan quota or per-minute ceiling (`quota_exceeded`,
   * `too_many_requests`).
   * `"open"` (default): allow the request and report via `onError` — nothing on our side,
   * billing included, may take your app down. `"closed"`: reject the request.
   * Mistakes in your code or setup (bad key, plan gate, bad request) always throw regardless.
   */
  failMode?: FailMode;
  /**
   * Abort an attempt after this long, retry once, then apply `failMode`. Default 1 000 ms, so
   * an outage adds at most ~2 s. A warm call takes 11–23 ms; the first call into a cold
   * Cloudflare location can take over a second, which is why this is not lower.
   */
  timeoutMs?: number;
  /** Called whenever `failMode` kicks in. Default: `console.warn`. */
  onError?: (error: LymitError) => void;
  /** Remember rejected identifiers locally until their `reset` so repeat offenders cost no network call. Default true. */
  enableEphemeralCache?: boolean;
  /** Override `fetch` (tests, custom agents). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface LimitOptions {
  /** Units to deduct (e.g. estimated LLM tokens). Non-negative integer; default 1. */
  cost?: number;
}

export interface SettleOptions {
  /** The `cost` you passed to `limit()` before the call. Non-negative integer. */
  reserved: number;
  /** What the call really cost, e.g. the response's total tokens. Non-negative integer. */
  actual: number;
}

export interface Namespace {
  readonly name: string;
  readonly config: LimitConfig;
  /** Check and consume for `identifier`. Resolves to a `LimitResponse`; never throws for a rejection. */
  limit(identifier: string, options?: LimitOptions): Promise<LimitResponse>;
  /**
   * Charge the real cost once you know it: refunds an over-estimate, or deducts the rest of
   * an under-estimate even if that leaves `identifier` in debt (later calls wait for refill
   * to repay it). Resolves to the state after settling, or `null` when there was nothing to
   * send (`actual === reserved`) or Lymit could not be reached — reported via `onError`.
   * The cost was already incurred, so an outage never fails your request here, whatever
   * `failMode` says.
   */
  settle(identifier: string, options: SettleOptions): Promise<LimitResponse | null>;
}

const DEFAULT_BASE_URL = "https://api.lymit.io";
const DEFAULT_TIMEOUT_MS = 1_000;

/**
 * The Lymit client. One instance per process; create namespaces from it.
 *
 * ```ts
 * const lymit = new Lymit({ apiKey: process.env.LYMIT_API_KEY });
 * const ai = lymit.namespace("ai_generation", {
 *   algorithm: "tokenBucket", capacity: 5000, refillRate: 1000, interval: "1h",
 * });
 * const { success, remaining, reset } = await ai.limit(user.id, { cost: estimatedTokens });
 * ```
 */
export class Lymit {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #failMode: FailMode;
  readonly #timeoutMs: number;
  readonly #onError: (error: LymitError) => void;
  readonly #cache: BlockCache | null;
  readonly #fetch: typeof fetch;

  constructor(options: LymitOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new LymitConfigError("Lymit: apiKey is required");
    }
    const failMode: unknown = options.failMode ?? "open";
    if (failMode !== "open" && failMode !== "closed") {
      throw new LymitConfigError(
        `Lymit: failMode must be "open" or "closed", got ${String(failMode)}`,
      );
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new LymitConfigError(
        `Lymit: timeoutMs must be a positive number, got ${String(timeoutMs)}`,
      );
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#failMode = failMode;
    this.#timeoutMs = timeoutMs;
    this.#onError =
      options.onError ??
      ((error) => {
        console.warn(error.message);
      });
    this.#cache = (options.enableEphemeralCache ?? true) ? new BlockCache() : null;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Declare a namespace. Config is validated here so mistakes surface at startup. */
  namespace(name: string, config: LimitConfig): Namespace {
    assertIdentifier(name, "namespace");
    resolveConfig(config);
    return {
      name,
      config,
      limit: (identifier, options = {}) => this.#limit(name, config, identifier, options),
      settle: (identifier, options) => this.#settle(name, config, identifier, options),
    };
  }

  async #limit(
    namespace: string,
    config: LimitConfig,
    identifier: string,
    { cost }: LimitOptions,
  ): Promise<LimitResponse> {
    assertIdentifier(identifier, "identifier");
    if (cost !== undefined) assertCost(cost);

    const cacheKey = `${namespace}${KEY_SEPARATOR}${identifier}`;
    const cached = this.#cache?.get(cacheKey, Date.now());
    if (cached) return cached;

    const body = JSON.stringify({
      namespace,
      identifier,
      ...(cost === undefined ? {} : { cost }),
      config,
    });
    let response: LimitResponse;
    try {
      response = await this.#request("/v1/limit", body);
    } catch (error) {
      if (!(error instanceof LymitError) || !appliesFailMode(error)) throw error;
      this.#onError(error);
      return fallback(this.#failMode, config, Date.now());
    }
    this.#cache?.remember(cacheKey, response, Date.now());
    return response;
  }

  async #settle(
    namespace: string,
    config: LimitConfig,
    identifier: string,
    { reserved, actual }: SettleOptions,
  ): Promise<LimitResponse | null> {
    assertIdentifier(identifier, "identifier");
    assertCost(reserved);
    assertCost(actual);
    const delta = actual - reserved;
    if (delta === 0) return null;

    const body = JSON.stringify({ namespace, identifier, delta, config });
    let response: LimitResponse;
    try {
      response = await this.#request("/v1/settle", body);
    } catch (error) {
      if (!(error instanceof LymitError) || !appliesFailMode(error)) throw error;
      this.#onError(error);
      return null;
    }
    // A refund can make a locally cached rejection wrong; let the next call ask the edge.
    if (delta < 0) this.#cache?.forget(`${namespace}${KEY_SEPARATOR}${identifier}`);
    return response;
  }

  /** One attempt plus one retry on network failure or timeout; never retries an HTTP response. */
  async #request(path: string, body: string): Promise<LimitResponse> {
    let lastError: LymitError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.#attempt(path, body);
      } catch (error) {
        if (
          error instanceof LymitError &&
          (error.code === "network_error" || error.code === "timeout")
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new LymitError("Lymit: request failed", { code: "network_error" });
  }

  async #attempt(path: string, body: string): Promise<LimitResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new LymitError(`Lymit: request timed out after ${String(this.#timeoutMs)} ms`, {
          code: "timeout",
          cause,
        });
      }
      throw new LymitError(`Lymit: network error (${describe(cause)})`, {
        code: "network_error",
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    const parsed: unknown = await response.json().catch(() => null);
    if ((response.status === 200 || response.status === 429) && !hasError(parsed)) {
      return toLimitResponse(parsed);
    }
    throw toError(response.status, parsed);
  }
}

/**
 * Trouble on our side → `failMode` applies: transport, server errors, and the workspace's
 * own quota and burst ceiling (a billing state, not a bug in the caller's code — it must not
 * turn every AI route into a 500). Mistakes in the caller's code or setup always throw.
 */
const FAIL_MODE_CODES: ReadonlySet<LymitErrorCode> = new Set([
  "network_error",
  "timeout",
  "internal",
  "quota_exceeded",
  "too_many_requests",
]);

function appliesFailMode(error: LymitError): boolean {
  return FAIL_MODE_CODES.has(error.code);
}

function fallback(mode: FailMode, config: LimitConfig, now: number): LimitResponse {
  const limit = config.algorithm === "tokenBucket" ? config.capacity : config.limit;
  return mode === "open"
    ? { success: true, limit, remaining: limit, reset: now }
    : { success: false, limit, remaining: 0, reset: now };
}

function hasError(parsed: unknown): parsed is { error: { code?: unknown; message?: unknown } } {
  return typeof parsed === "object" && parsed !== null && "error" in parsed;
}

function toLimitResponse(raw: unknown): LimitResponse {
  const r = raw as Partial<LimitResponse> | null;
  if (
    r === null ||
    typeof r.success !== "boolean" ||
    typeof r.limit !== "number" ||
    typeof r.remaining !== "number" ||
    typeof r.reset !== "number"
  ) {
    throw new LymitError("Lymit: unexpected response shape", { code: "internal", status: 200 });
  }
  return {
    success: r.success,
    limit: r.limit,
    remaining: r.remaining,
    reset: r.reset,
    ...(typeof r.retryAfter === "number" ? { retryAfter: r.retryAfter } : {}),
  };
}

function toError(status: number, parsed: unknown): LymitError {
  let code: LymitErrorCode = status >= 500 ? "internal" : "bad_request";
  let message = `Lymit: HTTP ${String(status)}`;
  if (hasError(parsed)) {
    if (typeof parsed.error.code === "string") code = parsed.error.code as LymitErrorCode;
    if (typeof parsed.error.message === "string") message = `Lymit: ${parsed.error.message}`;
  }
  return new LymitError(message, { code, status });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
