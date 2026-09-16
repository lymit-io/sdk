import { test } from "node:test";
import * as sdk from "../dist/index.js";
import { smoke } from "./smoke.mjs";

test("@lymit/sdk on Node (ESM)", async () => {
  console.log(await smoke(sdk, "node-esm"));
});

test("@lymit/sdk on Node (CJS)", async () => {
  const { createRequire } = await import("node:module");
  const cjs = createRequire(import.meta.url)("../dist/index.cjs");
  console.log(await smoke(cjs, "node-cjs"));
});
