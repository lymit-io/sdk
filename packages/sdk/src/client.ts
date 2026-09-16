import {
  assertCost,
  assertIdentifier,
  LymitConfigError,
  resolveConfig,
  type LimitConfig,
  type LimitResponse,
} from "@lymit/core";
import { LymitError, type LymitErrorCode } from "./errors.js";

export interface LymitOptions {
  /** Your workspace API key (`lym_live_…`). */
  apiKey: string;
  /** Edge API origin. Default `https://api.lymit.io`. */
  baseUrl?: string;
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
  readonly #fetch: typeof fetch;

  constructor(options: LymitOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new LymitConfigError("Lymit: apiKey is required");
    }
    this.#apiKey = options.apiKey;
    this.#endpoint = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/limit`;
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

    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        namespace,
        identifier,
        ...(cost === undefined ? {} : { cost }),
        config,
      }),
    });

    if (response.status === 200 || response.status === 429) {
      return toLimitResponse(await response.json());
    }
    throw await toError(response);
  }
}

function toLimitResponse(raw: unknown): LimitResponse {
  const r = raw as Partial<LimitResponse>;
  if (
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

async function toError(response: Response): Promise<LymitError> {
  let code: LymitErrorCode = "internal";
  let message = `Lymit: HTTP ${String(response.status)}`;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code as LymitErrorCode;
    if (typeof body.error?.message === "string") message = `Lymit: ${body.error.message}`;
  } catch {
    // Non-JSON error body; keep the status-based message.
  }
  return new LymitError(message, { code, status: response.status });
}
