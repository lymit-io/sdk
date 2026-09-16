import * as sdk from "../dist/index.js";
import { smoke } from "./smoke.mjs";

Deno.test("@lymit/sdk on Deno", async () => {
  console.log(await smoke(sdk, "deno"));
});
