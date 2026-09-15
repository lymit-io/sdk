import { describe, expect, it } from "vitest";
import { LymitConfigError } from "./errors.js";
import { assertIdentifier, KEY_SEPARATOR, keyFor, MAX_IDENTIFIER_LENGTH } from "./key.js";

const SEP = String.fromCodePoint(0x1f);

describe("keyFor", () => {
  it("joins workspace, namespace and identifier with the ASCII unit separator", () => {
    expect(KEY_SEPARATOR).toBe(SEP);
    expect(keyFor("ws_1", "ai_generation", "user_123")).toBe(
      ["ws_1", "ai_generation", "user_123"].join(SEP),
    );
  });

  it("is injective: different parts never collide", () => {
    expect(keyFor("a", "b:c", "d")).not.toBe(keyFor("a:b", "c", "d"));
    expect(keyFor("a", "b", "c:d")).not.toBe(keyFor("a", "b:c", "d"));
  });

  it("allows the business identifiers we advertise", () => {
    for (const id of ["user_123", "tier:pro", "workspace-42", "a@b.com", "192.168.0.1", "日本"]) {
      expect(() => keyFor("ws", "ns", id)).not.toThrow();
    }
  });

  it.each([
    ["", "empty"],
    [`a${SEP}b`, "contains the separator"],
    ["x".repeat(MAX_IDENTIFIER_LENGTH + 1), "too long"],
  ])("rejects identifier %j (%s)", (id) => {
    expect(() => keyFor("ws", "ns", id)).toThrow(LymitConfigError);
  });

  it("rejects an empty or separator-containing namespace", () => {
    expect(() => keyFor("ws", "", "id")).toThrow(LymitConfigError);
    expect(() => keyFor("ws", `a${SEP}b`, "id")).toThrow(LymitConfigError);
  });
});

describe("assertIdentifier", () => {
  it("returns the identifier unchanged when valid", () => {
    expect(assertIdentifier("tier:pro")).toBe("tier:pro");
  });

  it("names the field in the error", () => {
    expect(() => assertIdentifier("", "namespace")).toThrow(/namespace/);
  });

  it("rejects non-strings", () => {
    expect(() => assertIdentifier(123 as never)).toThrow(LymitConfigError);
  });
});
