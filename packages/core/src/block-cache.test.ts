import { describe, expect, it } from "vitest";
import { BlockCache } from "./block-cache.js";
import type { LimitResponse } from "./types.js";

const T0 = 1_700_000_000_000;
const rejected = (reset: number, retryAfter: number): LimitResponse => ({
  success: false,
  limit: 100,
  remaining: 0,
  reset,
  retryAfter,
});

describe("BlockCache", () => {
  it("misses on an unknown key", () => {
    const cache = new BlockCache();
    expect(cache.get("a", T0)).toBeNull();
  });

  it("remembers a rejection until its reset time", () => {
    const cache = new BlockCache();
    cache.remember("a", rejected(T0 + 10_000, 10_000), T0);
    const hit = cache.get("a", T0 + 4_000);
    expect(hit).toEqual({
      success: false,
      limit: 100,
      remaining: 0,
      reset: T0 + 10_000,
      retryAfter: 6_000,
    });
  });

  it("expires exactly at reset and drops the entry", () => {
    const cache = new BlockCache();
    cache.remember("a", rejected(T0 + 10_000, 10_000), T0);
    expect(cache.get("a", T0 + 9_999)).not.toBeNull();
    expect(cache.get("a", T0 + 10_000)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("never stores a success", () => {
    const cache = new BlockCache();
    cache.remember("a", { success: true, limit: 100, remaining: 5, reset: T0 + 10_000 }, T0);
    expect(cache.size).toBe(0);
    expect(cache.get("a", T0)).toBeNull();
  });

  it("ignores a rejection that can never be retried (no retryAfter) — nothing to wait out", () => {
    const cache = new BlockCache();
    cache.remember("a", { success: false, limit: 100, remaining: 0, reset: T0 }, T0);
    expect(cache.size).toBe(0);
  });

  it("ignores a rejection whose reset is already in the past", () => {
    const cache = new BlockCache();
    cache.remember("a", rejected(T0 - 1, 0), T0);
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new BlockCache({ maxEntries: 2 });
    cache.remember("a", rejected(T0 + 60_000, 60_000), T0);
    cache.remember("b", rejected(T0 + 60_000, 60_000), T0);
    cache.get("a", T0 + 1); // touch a so b becomes the LRU
    cache.remember("c", rejected(T0 + 60_000, 60_000), T0 + 2);
    expect(cache.size).toBe(2);
    expect(cache.get("b", T0 + 3)).toBeNull();
    expect(cache.get("a", T0 + 3)).not.toBeNull();
    expect(cache.get("c", T0 + 3)).not.toBeNull();
  });

  it("re-remembering a key refreshes its expiry and recency", () => {
    const cache = new BlockCache({ maxEntries: 2 });
    cache.remember("a", rejected(T0 + 1_000, 1_000), T0);
    cache.remember("b", rejected(T0 + 60_000, 60_000), T0);
    cache.remember("a", rejected(T0 + 60_000, 60_000), T0);
    cache.remember("c", rejected(T0 + 60_000, 60_000), T0);
    expect(cache.get("b", T0 + 1)).toBeNull();
    expect(cache.get("a", T0 + 5_000)).not.toBeNull();
  });

  it("clear() empties the cache", () => {
    const cache = new BlockCache();
    cache.remember("a", rejected(T0 + 60_000, 60_000), T0);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("rejects a non-positive maxEntries", () => {
    expect(() => new BlockCache({ maxEntries: 0 })).toThrow();
  });
});
