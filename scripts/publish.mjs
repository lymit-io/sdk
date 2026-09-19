// Publish every public workspace package with the npm CLI (npm Trusted Publishing works with
// npm itself, not `pnpm publish`). Idempotent: versions already on the registry are skipped,
// so the Release workflow can re-run safely. Order matters only for humans: core, then sdk.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

for (const dir of ["packages/core", "packages/sdk"]) {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  if (pkg.private) continue;
  const spec = `${pkg.name}@${pkg.version}`;
  const view = spawnSync("npm", ["view", spec, "version", "--json"], { encoding: "utf8" });
  if (view.status === 0 && view.stdout.trim().length > 0) {
    console.log(`${spec} is already published; nothing to do.`);
    continue;
  }
  console.log(`Publishing ${spec}…`);
  execFileSync("npm", ["publish", "--access", "public"], { cwd: dir, stdio: "inherit" });
  // Changesets' action looks for this line to create the GitHub release.
  console.log(`New tag: ${spec}`);
}
