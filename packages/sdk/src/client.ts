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
   * What to do when Lymit cannot be reached or returns a server error.
   * `"open"` (default): allow the request and report via `onError` — an outage on our side
   * must never take your app down. `"closed"`: reject the request.
   * Client-side errors (bad key, plan gate, bad request) always throw regardless.
   */
  failMode?: FailMode;
  /** Abort a check after this long and apply `failMode`. Default 3 000 ms. */
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

export interface Namespace {
  readonly name: string;
  readonly config: LimitConfig;
  /** Check and consume for `identifier`. Resolves to a `LimitResponse`; never throws for a rejection. */
  limit(identifier: string, options?: LimitOptions): Promise<LimitResponse>;
}

const DEFAULT_BASE_URL = "https://api.lymit.io";
const DEFAULT_TIMEOUT_MS = 3_000;

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
  readonly #endpoint: string;
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
    this.#endpoint = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/limit`;
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
      response = await this.#request(body);
    } catch (error) {
      if (!(error instanceof LymitError) || !isOurFault(error)) throw error;
      this.#onError(error);
      return fallback(this.#failMode, config, Date.now());
    }
    this.#cache?.remember(cacheKey, response, Date.now());
    return response;
  }

  /** One attempt plus one retry on network failure or timeout; never retries an HTTP response. */
  async #request(body: string): Promise<LimitResponse> {
    let lastError: LymitError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.#attempt(body);
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

  async #attempt(body: string): Promise<LimitResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
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

/** Server-side or transport trouble → `failMode` applies. Client-side mistakes always throw. */
function isOurFault(error: LymitError): boolean {
  return error.code === "network_error" || error.code === "timeout" || error.code === "internal";
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
