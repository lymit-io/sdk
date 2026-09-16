import { test } from "bun:test";
import * as sdk from "../dist/index.js";
import { smoke } from "./smoke.mjs";

test("@lymit/sdk on Bun", async () => {
  console.log(await smoke(sdk, "bun"));
});
