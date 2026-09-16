import { describe, expect, it, vi } from "vitest";
import { Lymit, LymitConfigError, LymitError } from "./index.js";

const ok = {
  success: true,
  limit: 500,
  remaining: 350,
  reset: 1_700_000_001_500,
  algorithm: "tokenBucket",
};
const blocked = { ...ok, success: false, remaining: 0, retryAfter: 1_000 };

/** A fetch mock that records requests and returns queued responses. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {}, body });
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error("no response queued"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetch, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const config = {
  algorithm: "tokenBucket",
  capacity: 500,
  refillRate: 100,
  interval: "1s",
} as const;

describe("Lymit", () => {
  it("requires an API key", () => {
    expect(() => new Lymit({ apiKey: "" })).toThrow(LymitConfigError);
    expect(() => new Lymit({} as never)).toThrow(LymitConfigError);
  });

  it("validates namespace config at construction, not on first call", () => {
    const lymit = new Lymit({ apiKey: "lym_test_x", fetch: fakeFetch().fetch });
    expect(() => lymit.namespace("ai", { ...config, interval: "1x" } as never)).toThrow(/interval/);
    expect(() => lymit.namespace("", config)).toThrow(/namespace/);
  });

  it("posts the documented body with the bearer key and returns the result", async () => {
    const { fetch, calls } = fakeFetch(json(ok));
    const lymit = new Lymit({ apiKey: "lym_test_x", fetch });
    const ai = lymit.namespace("ai", config);
    const result = await ai.limit("user_1", { cost: 150 });

    expect(result).toEqual({ success: true, limit: 500, remaining: 350, reset: 1_700_000_001_500 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.lymit.io/v1/limit");
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer lym_test_x");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(calls[0]?.body).toEqual({
      namespace: "ai",
      identifier: "user_1",
      cost: 150,
      config,
    });
  });

  it("defaults cost to 1 and omits it from the body", async () => {
    const { fetch, calls } = fakeFetch(json(ok));
    await new Lymit({ apiKey: "k", fetch }).namespace("ai", config).limit("u");
    expect(calls[0]?.body).not.toHaveProperty("cost");
  });

  it("validates identifier and cost before calling the network", async () => {
    const { fetch } = fakeFetch();
    const ai = new Lymit({ apiKey: "k", fetch }).namespace("ai", config);
    await expect(ai.limit("")).rejects.toThrow(LymitConfigError);
    await expect(ai.limit("u", { cost: -1 })).rejects.toThrow(LymitConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honours a custom baseUrl with or without a trailing slash", async () => {
    for (const baseUrl of ["http://localhost:8787", "http://localhost:8787/"]) {
      const { fetch, calls } = fakeFetch(json(ok));
      await new Lymit({ apiKey: "k", baseUrl, fetch }).namespace("ai", config).limit("u");
      expect(calls[0]?.url).toBe("http://localhost:8787/v1/limit");
    }
  });

  it("returns a 429 as a normal rejected result, not an error", async () => {
    const { fetch } = fakeFetch(json(blocked, 429));
    const result = await new Lymit({ apiKey: "k", fetch }).namespace("ai", config).limit("u");
    expect(result).toEqual({
      success: false,
      limit: 500,
      remaining: 0,
      reset: 1_700_000_001_500,
      retryAfter: 1_000,
    });
  });

  it("surfaces 4xx API errors as LymitError with the server's code", async () => {
    const { fetch } = fakeFetch(json({ error: { code: "invalid_api_key", message: "nope" } }, 401));
    const ai = new Lymit({ apiKey: "k", fetch }).namespace("ai", config);
    await expect(ai.limit("u")).rejects.toMatchObject({
      name: "LymitError",
      code: "invalid_api_key",
      status: 401,
    });
  });

  it("surfaces a plan gate as LymitError feature_not_in_plan", async () => {
    const { fetch } = fakeFetch(
      json({ error: { code: "feature_not_in_plan", message: "no" } }, 403),
    );
    await expect(
      new Lymit({ apiKey: "k", fetch }).namespace("ai", config).limit("u"),
    ).rejects.toMatchObject({
      code: "feature_not_in_plan",
    });
  });

  it("sends the same request when called from several namespaces on one client", async () => {
    const { fetch, calls } = fakeFetch(json(ok), json(ok));
    const lymit = new Lymit({ apiKey: "k", fetch });
    await lymit.namespace("ai", config).limit("u");
    await lymit.namespace("api", { algorithm: "fixedWindow", limit: 10, window: "1m" }).limit("u");
    expect(calls.map((c) => (c.body as { namespace: string }).namespace)).toEqual(["ai", "api"]);
  });

  it("exposes LymitError as an Error subclass", () => {
    const err = new LymitError("x", { code: "internal", status: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LymitError");
  });
});
