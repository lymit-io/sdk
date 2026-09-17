import { LymitConfigError } from "./errors.js";
import type { LimitResponse } from "./types.js";

export interface BlockCacheOptions {
  /** Upper bound on entries; the least recently used entry is evicted beyond it. Default 10 000. */
  maxEntries?: number;
  /**
   * Longest an entry is trusted, in ms, however far away its `reset` is. Default 60 000 —
   * the same bound as the edge's config caches, so a dashboard change (an override removed,
   * a limit raised) reaches a blocked identifier within a minute instead of at the end of
   * its window. Costs one extra round trip per blocked identifier per minute.
   */
  maxTtlMs?: number;
}

interface Entry {
  limit: number;
  reset: number;
  /** When the entry stops being trusted: `min(reset, rememberedAt + maxTtlMs)`. */
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_TTL_MS = 60_000;

/**
 * Ephemeral in-memory cache of identifiers known to be blocked, keyed by whatever the
 * caller chooses (see `keyFor`). Lets the SDK and the edge answer a repeat offender with
 * zero network hops until their `reset` time passes.
 *
 * Only rejections are stored, and only ones that will clear on their own (they carry a
 * `retryAfter`). The cache never decides to *allow* anything, so a stale or evicted entry
 * can only cost one extra round trip, never leak capacity.
 *
 * This is deliberately a mutable object: it is a cache, and its whole purpose is to hold
 * state across calls. Entries are kept in `Map` insertion order, which doubles as the
 * LRU order once we re-insert on access.
 */
export class BlockCache {
  readonly #entries = new Map<string, Entry>();
  readonly #maxEntries: number;
  readonly #maxTtlMs: number;

  constructor(options: BlockCacheOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(max) || max <= 0) {
      throw new LymitConfigError(`Invalid maxEntries ${String(max)}: must be a positive integer`);
    }
    const ttl = options.maxTtlMs ?? DEFAULT_MAX_TTL_MS;
    if (!(ttl > 0)) {
      throw new LymitConfigError(`Invalid maxTtlMs ${String(ttl)}: must be positive`);
    }
    this.#maxEntries = max;
    this.#maxTtlMs = ttl;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Returns a synthesised rejection if `key` is still blocked at `now`, otherwise `null`. */
  get(key: string, now: number): LimitResponse | null {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (now >= entry.expiresAt) {
      this.#entries.delete(key);
      return null;
    }
    // Re-insert to mark as most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return {
      success: false,
      limit: entry.limit,
      remaining: 0,
      reset: entry.reset,
      retryAfter: entry.reset - now,
    };
  }

  /** Record a response. Successes and un-retryable or already-expired rejections are ignored. */
  remember(key: string, response: LimitResponse, now: number): void {
    if (response.success || response.retryAfter === undefined || response.reset <= now) {
      return;
    }
    this.#entries.delete(key);
    this.#entries.set(key, {
      limit: response.limit,
      reset: response.reset,
      expiresAt: Math.min(response.reset, now + this.#maxTtlMs),
    });
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  /** Drop every entry whose key starts with `prefix` (e.g. one workspace's, via `keyFor`). */
  forget(prefix: string): void {
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }
}
