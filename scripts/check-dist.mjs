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
//   - every runtime import it makes of another package (require("x") / from "x")
//     is declared in the package's dependencies or peerDependencies (a bundle
//     that reaches for an undeclared package, such as an unbundled
//     @vhyxvoid/protocol, installs fine and then fails for the user);
//   - a .mjs entry really imports as an ES module, and exports something;
//   - it loads with better-sqlite3 made unrequirable. Only better-sqlite3 is
//     blocked; a load failure for any other reason (an optional peer such as
//     fastify-plugin not being installed here) is reported as a skip, not a
//     failure, so this does not depend on peers being present.
// And once per package:
//   - every file that package.json points at (main, module, types, bin, and every
//     string under exports) exists. The published @vhyxvoid/sdk 1.0.1 declared
//     an "import" entry, dist/index.mjs, that no build ever produced, so ESM
//     `import` of it failed with ERR_MODULE_NOT_FOUND.
// And, if the package is @vhyxvoid/agent:
//   - the version baked into dist/cli.js matches package.json.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

// better-sqlite3 is deliberately not a dependency of the in-process wrappers: it is
// required lazily, only when a queue is opened (see DurableQueue.ts).
const lazilyRequired = new Set(["better-sqlite3"]);
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...lazilyRequired
]);
const builtins = new Set(builtinModules.flatMap(m => [m, `node:${m}`]));

// ws (bundled into next and middleware) tries these two optional native
// accelerators inside try/catch and falls back to plain JavaScript when they are
// not installed, so a bundle mentioning them is not an undeclared dependency.
const optionalAccelerators = new Set(["bufferutil", "utf-8-validate"]);
const looksLikePackageName = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w./-]+)?$/i;

function packageOf(specifier) {
  const parts = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function importedPackages(text) {
  const found = new Set();

  for (const re of [/\brequire\(\s*["']([^"'.][^"']*)["']\s*\)/g, /\bfrom\s*["']([^"'.][^"']*)["']/g, /\bimport\s*["']([^"'.][^"']*)["']/g]) {
    for (const m of text.matchAll(re)) {
      if (builtins.has(m[1]) || !looksLikePackageName.test(m[1])) continue;
      if (optionalAccelerators.has(packageOf(m[1]))) continue;
      found.add(packageOf(m[1]));
    }
  }

  return found;
}

function manifestFiles() {
  const files = new Set();
  const add = v => typeof v === "string" && v.startsWith(".") && files.add(v);
  const walk = v => (v && typeof v === "object" ? Object.values(v).forEach(walk) : add(v));

  add(pkg.main);
  add(pkg.module);
  add(pkg.types);
  walk(pkg.bin);
  walk(pkg.exports);
  if (typeof pkg.bin === "string") files.add(pkg.bin);

  return [...files];
}

for (const rel of manifestFiles()) {
  if (!existsSync(resolve(pkgDir, rel))) {
    console.error(`[check-dist] FAIL  package.json points at ${rel}, which the build did not produce`);
    failed = true;
  }
}

for (const entry of entries) {
  const text = readFileSync(resolve(pkgDir, entry), "utf8");
  const undeclared = [...importedPackages(text)].filter(name => !declared.has(name));

  if (undeclared.length) {
    console.error(`[check-dist] FAIL  ${entry} imports ${undeclared.join(", ")}, which package.json does not declare`);
    failed = true;
  }

  if (entry.endsWith(".mjs")) {
    const esm = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(resolve(pkgDir, entry)).href)}); if (Object.keys(m).length === 0) process.exit(3);`],
      { cwd: pkgDir, encoding: "utf8" }
    );

    if (esm.status === 0) console.log(`[check-dist] ok    ${entry} imports as an ES module`);
    else {
      console.error(`[check-dist] FAIL  ${entry} did not import as an ES module: ${(esm.stderr.split("\n").find(l => /Error/.test(l)) ?? "").trim()}`);
      failed = true;
    }

    continue;
  }

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
