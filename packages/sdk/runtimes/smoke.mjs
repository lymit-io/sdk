// Runtime-agnostic smoke test for the BUILT SDK. Each runtime's test file imports dist/
// and calls `smoke()`; it throws on any failure so it works with every test runner.
// Offline: a fake fetch stands in for the Edge API. Set LYMIT_BASE_URL and LYMIT_API_KEY
// to also make one real call.

const reset = Date.now() + 60_000; // must be in the future or the block cache (correctly) ignores it
const ok = { success: true, limit: 500, remaining: 350, reset };
const blocked = { success: false, limit: 500, remaining: 0, reset, retryAfter: 60_000 };

function assert(condition, message) {
  if (!condition) throw new Error(`smoke: ${message}`);
}

export async function smoke({ Lymit, LymitError }, runtime) {
  const calls = [];
  const queue = [ok, blocked, { error: { code: "invalid_api_key", message: "nope" } }];
  const statuses = [200, 429, 401];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const i = calls.length - 1;
    return new Response(JSON.stringify(queue[i]), {
      status: statuses[i],
      headers: { "content-type": "application/json" },
    });
  };

  const lymit = new Lymit({ apiKey: "lym_test_smoke", fetch, onError: () => undefined });
  const ai = lymit.namespace("ai", {
    algorithm: "tokenBucket",
    capacity: 500,
    refillRate: 100,
    interval: "1s",
  });

  const first = await ai.limit("user_1", { cost: 150 });
  assert(first.success === true && first.remaining === 350, `success path on ${runtime}`);
  assert(calls[0].url.endsWith("/v1/limit"), "posts to /v1/limit");
  assert(
    new Headers(calls[0].init.headers).get("authorization") === "Bearer lym_test_smoke",
    "sends bearer",
  );
  const body = JSON.parse(calls[0].init.body);
  assert(
    body.namespace === "ai" && body.identifier === "user_1" && body.cost === 150,
    "body shape",
  );
  assert(calls[0].init.signal instanceof AbortSignal, "timeout signal attached");

  const second = await ai.limit("user_1", { cost: 150 });
  assert(
    second.success === false && second.retryAfter === 60_000,
    "rejection is a result, not an error",
  );

  // Blocked identifier is served from the in-process cache: no third fetch for it.
  const cachedCalls = calls.length;
  const cached = await ai.limit("user_1");
  assert(
    cached.success === false && calls.length === cachedCalls,
    "ephemeral cache short-circuits",
  );

  let thrown = null;
  try {
    await ai.limit("user_2");
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof LymitError && thrown.code === "invalid_api_key",
    "client error throws LymitError",
  );

  // Fail-open on a network failure, after one retry.
  let attempts = 0;
  const down = new Lymit({
    apiKey: "k",
    fetch: async () => {
      attempts += 1;
      throw new TypeError("fetch failed");
    },
    onError: () => undefined,
  });
  const open = await down
    .namespace("api", { algorithm: "fixedWindow", limit: 10, window: "1m" })
    .limit("u");
  assert(open.success === true && attempts === 2, "fails open after one retry");

  const baseUrl = readEnv("LYMIT_BASE_URL");
  const apiKey = readEnv("LYMIT_API_KEY");
  if (baseUrl && apiKey) {
    const real = new Lymit({ apiKey, baseUrl });
    const r = await real
      .namespace("smoke", { algorithm: "fixedWindow", limit: 1_000, window: "1m" })
      .limit(runtime);
    assert(
      typeof r.success === "boolean" && typeof r.remaining === "number",
      "real call against " + baseUrl,
    );
    return { runtime, offline: true, live: true };
  }
  return { runtime, offline: true, live: false };
}

function readEnv(name) {
  const g = globalThis;
  if (g.Deno?.env?.get) return g.Deno.env.get(name);
  return g.process?.env?.[name];
}
