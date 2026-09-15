import { describe, expect, it } from "vitest";
import { LymitConfigError } from "../errors.js";
import type { ResolvedFixedWindowConfig } from "../types.js";
import { fixedWindow, type FixedWindowState } from "./fixed-window.js";

const config: ResolvedFixedWindowConfig = { algorithm: "fixedWindow", limit: 5, windowMs: 60_000 };
// A "now" that sits 10s into an epoch-aligned minute, so window maths is visible in assertions.
const WINDOW_START = 1_700_000_040_000;
const NOW = WINDOW_START + 10_000;

describe("fixedWindow", () => {
  it("allows the first request and opens a window aligned to the epoch", () => {
    const { state, response } = fixedWindow(null, config, NOW);
    expect(state).toEqual<FixedWindowState>({ windowStart: WINDOW_START, count: 1 });
    expect(response).toEqual({
      success: true,
      limit: 5,
      remaining: 4,
      reset: WINDOW_START + 60_000,
    });
  });

  it("counts up to the limit and rejects the request that would exceed it", () => {
    let state: FixedWindowState | null = null;
    for (let i = 1; i <= 5; i++) {
      const result = fixedWindow(state, config, NOW + i);
      expect(result.response.success).toBe(true);
      expect(result.response.remaining).toBe(5 - i);
      state = result.state;
    }
    const rejected = fixedWindow(state, config, NOW + 6);
    expect(rejected.response).toEqual({
      success: false,
      limit: 5,
      remaining: 0,
      reset: WINDOW_START + 60_000,
      retryAfter: WINDOW_START + 60_000 - (NOW + 6),
    });
    // A rejection never consumes.
    expect(rejected.state.count).toBe(5);
  });

  it("resets the count when the window rolls over", () => {
    const full: FixedWindowState = { windowStart: WINDOW_START, count: 5 };
    const nextWindow = WINDOW_START + 60_000;
    const { state, response } = fixedWindow(full, config, nextWindow + 1);
    expect(state).toEqual({ windowStart: nextWindow, count: 1 });
    expect(response.success).toBe(true);
    expect(response.remaining).toBe(4);
    expect(response.reset).toBe(nextWindow + 60_000);
  });

  it("treats a stale state from many windows ago as empty", () => {
    const ancient: FixedWindowState = { windowStart: WINDOW_START - 60_000 * 1000, count: 5 };
    expect(fixedWindow(ancient, config, NOW).response.remaining).toBe(4);
  });

  it("deducts cost > 1", () => {
    const { state, response } = fixedWindow(null, config, NOW, 3);
    expect(state.count).toBe(3);
    expect(response.remaining).toBe(2);
    const second = fixedWindow(state, config, NOW, 3);
    expect(second.response.success).toBe(false);
    expect(second.response.remaining).toBe(2);
    expect(second.state.count).toBe(3);
  });

  it("rejects a cost larger than the limit without consuming anything", () => {
    const { state, response } = fixedWindow(null, config, NOW, 6);
    expect(response.success).toBe(false);
    expect(response.remaining).toBe(5);
    expect(state.count).toBe(0);
  });

  it("treats cost 0 as a read that never consumes", () => {
    const { state, response } = fixedWindow(
      { windowStart: WINDOW_START, count: 5 },
      config,
      NOW,
      0,
    );
    expect(response.success).toBe(true);
    expect(response.remaining).toBe(0);
    expect(state.count).toBe(5);
  });

  it("does not reset if the stored window is ahead of the local clock (clock skew)", () => {
    // Another node with a slightly fast clock already opened the next window; do not
    // hand out a fresh allowance just because this node thinks it is still the old one.
    const ahead: FixedWindowState = { windowStart: WINDOW_START + 60_000, count: 5 };
    const { state, response } = fixedWindow(ahead, config, NOW);
    expect(response.success).toBe(false);
    expect(state).toEqual(ahead);
    expect(response.reset).toBe(WINDOW_START + 120_000);
  });

  it("never mutates the input state", () => {
    const input = Object.freeze({ windowStart: WINDOW_START, count: 2 });
    const { state } = fixedWindow(input, config, NOW);
    expect(input).toEqual({ windowStart: WINDOW_START, count: 2 });
    expect(state).not.toBe(input);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid cost %p", (cost) => {
    expect(() => fixedWindow(null, config, NOW, cost)).toThrow(LymitConfigError);
  });
});
