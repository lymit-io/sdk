import { LymitConfigError } from "./errors.js";
import type { LimitResponse } from "./types.js";

export interface BlockCacheOptions {
  /** Upper bound on entries; the least recently used entry is evicted beyond it. Default 10 000. */
  maxEntries?: number;
}

interface Entry {
  limit: number;
  reset: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

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

  constructor(options: BlockCacheOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(max) || max <= 0) {
      throw new LymitConfigError(`Invalid maxEntries ${String(max)}: must be a positive integer`);
    }
    this.#maxEntries = max;
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
    if (now >= entry.reset) {
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
    this.#entries.set(key, { limit: response.limit, reset: response.reset });
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
}
