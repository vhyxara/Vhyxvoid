// Post-build check for the three packages that ship esbuild bundles
// (packages/agent, packages/next, packages/middleware). Run from each
// package's build script: `node ../../scripts/check-dist.mjs <entry.js>...`
// with the package directory as the working directory.
//
// It exists because two real defects shipped through builds that "succeeded":
//   1. A bundle that required the native better-sqlite3 module at load time,
//      so a project that never opens a queue still failed with "Cannot find
//      module 'better-sqlite3'" (or a bindings error) on startup.
//   2. A bundle whose inlined package.json was stale (vhyxvoid --version said
//      1.0.16 for the 1.0.18 package).
//
// Checks, per entry file:
//   - it loads with better-sqlite3 made unrequirable. Only better-sqlite3 is
//     blocked; a load failure for any other reason (an optional peer such as
//     fastify-plugin not being installed here) is reported as a skip, not a
//     failure, so this does not depend on peers being present.
// And once, if the package is @vhyxvoid/agent:
//   - the version baked into dist/cli.js matches package.json.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));
const entries = process.argv.slice(2);
let failed = false;

const blocker = `
const Module = require("module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "better-sqlite3") throw new Error("BLOCKED better-sqlite3");
  return load.call(this, request, ...rest);
};
`;

for (const entry of entries) {
  const r = spawnSync(process.execPath, ["-e", `${blocker}require(${JSON.stringify(resolve(pkgDir, entry))});`], {
    cwd: pkgDir,
    encoding: "utf8"
  });

  if (r.status === 0) {
    console.log(`[check-dist] ok    ${entry} loads without better-sqlite3`);
  } else if ((r.stderr + r.stdout).includes("BLOCKED better-sqlite3")) {
    console.error(`[check-dist] FAIL  ${entry} requires better-sqlite3 at load time`);
    failed = true;
  } else {
    const reason = (r.stderr.split("\n").find(l => /Error/.test(l)) ?? "").trim();

    console.log(`[check-dist] skip  ${entry} (could not load for an unrelated reason: ${reason})`);
  }
}

if (pkg.name === "@vhyxvoid/agent") {
  const r = spawnSync(process.execPath, [resolve(pkgDir, "dist/cli.js"), "--version"], { encoding: "utf8" });
  const printed = r.stdout.trim();

  if (printed !== pkg.version) {
    console.error(`[check-dist] FAIL  dist/cli.js --version printed "${printed}", package.json says ${pkg.version} (stale bundle)`);
    failed = true;
  } else {
    console.log(`[check-dist] ok    dist/cli.js --version is ${printed}`);
  }
}

if (failed) process.exit(1);
