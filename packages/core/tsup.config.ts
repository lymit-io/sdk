import { defineConfig } from "tsup";

// Built only so @lymit/sdk can inline core's declarations; in-repo consumers import src/.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
});
