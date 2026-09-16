import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Customers install one dependency-free package: @lymit/core's JS is inlined here...
  noExternal: ["@lymit/core"],
  // ...and its declarations are inlined from core's built dist (see the prebuild script).
  dts: {
    resolve: true,
    compilerOptions: { paths: { "@lymit/core": ["../core/dist/index.d.ts"] } },
  },
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  treeshake: true,
});
