import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Guards context.md risks #15/#17 and the 2026-09-19 finding that
// @vhyxvoid/next@1.0.3 and @vhyxvoid/middleware@1.0.3 were published with
// `"dependencies": {}` while their bundles imported better-sqlite3, so a
// clean `next dev` failed with "Cannot find module 'better-sqlite3'".
//
// How those two packages ship: esbuild INLINES @vhyxvoid/agent (and ws, axios,
// ...) into dist/, so @vhyxvoid/agent is a build-time input, not a runtime
// dependency. Declaring it under `dependencies` is wrong twice over: it is
// unused at runtime, and `npm publish` (as opposed to `pnpm publish`) ships
// `workspace:*` verbatim, which no consumer can install. The only thing left
// external that is not a peer is better-sqlite3, so it must never be required
// at load time (see DurableQueue.ts) — otherwise it would have to be a
// declared dependency and every Next/Express user would compile a native module
// they never use.

const root = path.resolve(__dirname, "../..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

const wrappers = ["packages/next", "packages/middleware"];

function externals(script: string): string[] {
  return [...script.matchAll(/--external:([^\s]+)/g)].map((m) => m[1]);
}

describe.each(wrappers)("%s manifest", (dir) => {
  const pkg = readJson(`${dir}/package.json`);

  it("declares no workspace: protocol version under dependencies (unpublishable with npm)", () => {
    for (const [name, range] of Object.entries<string>(pkg.dependencies ?? {})) {
      expect(range, `${name} in dependencies`).not.toMatch(/^workspace:/);
    }
  });

  it("keeps @vhyxvoid/agent as a build-time devDependency, not a runtime dependency", () => {
    expect(pkg.dependencies?.["@vhyxvoid/agent"]).toBeUndefined();
    expect(pkg.devDependencies?.["@vhyxvoid/agent"]).toBeDefined();
  });

  it("only leaves external what the consumer provides (peer dependency) or what is lazily loaded", () => {
    const lazilyLoaded = new Set(["better-sqlite3"]);
    const provided = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...lazilyLoaded,
    ]);
    for (const ext of externals(pkg.scripts.build)) {
      expect(provided.has(ext), `--external:${ext} is neither declared nor lazily loaded`).toBe(true);
    }
  });
});

// @vhyxvoid/sdk, found in the 2026-09-19 sdk publish prep. Published 1.0.1 (a) declared
// "import": "./dist/index.mjs" and "module" pointing at a file no build produced, so
// `import { createClient } from '@vhyxvoid/sdk'` failed with ERR_MODULE_NOT_FOUND;
// (b) shipped tsc's per-file output, which `require`s @vhyxvoid/protocol at runtime,
// with protocol as `workspace:*` (uninstallable via npm publish; via pnpm it became a
// dependency on the old protocol 1.0.0, which has no isBinaryContentType); and
// (c) depended on the npm placeholder package `crypto`. The bundle now inlines
// protocol (from its source, so the ESM build has no CommonJS in it) and emits both
// index.js and index.mjs; scripts/check-dist.mjs verifies the emitted files and that
// index.mjs really imports.
describe("packages/sdk manifest", () => {
  const pkg = readJson("packages/sdk/package.json");

  it("declares no workspace: version under dependencies (unpublishable with npm)", () => {
    for (const [name, range] of Object.entries<string>(pkg.dependencies ?? {})) {
      expect(range, `${name} in dependencies`).not.toMatch(/^workspace:/);
    }
  });

  it("inlines @vhyxvoid/protocol at build, so it is a devDependency and not a runtime one", () => {
    expect(pkg.dependencies?.["@vhyxvoid/protocol"]).toBeUndefined();
    expect(pkg.devDependencies?.["@vhyxvoid/protocol"]).toBeDefined();
    expect(pkg.scripts.build).toContain("--alias:@vhyxvoid/protocol=");
  });

  it("does not depend on the deprecated `crypto` placeholder package (the code uses Node's built-in)", () => {
    expect(pkg.dependencies?.crypto).toBeUndefined();
  });

  it("only leaves ws and isomorphic-ws external, and declares them", () => {
    expect([...new Set(externals(pkg.scripts.build))].sort()).toEqual(["isomorphic-ws", "ws"]);
    expect(pkg.dependencies.ws).toBeDefined();
    expect(pkg.dependencies["isomorphic-ws"]).toBeDefined();
  });

  it("builds every file its manifest points at (index.js for require, index.mjs for import)", () => {
    expect(pkg.exports["."].import).toBe("./dist/index.mjs");
    expect(pkg.exports["."].require).toBe("./dist/index.js");
    expect(pkg.scripts.build).toContain("--format=esm");
    expect(pkg.scripts.build).toContain("--outfile=dist/index.mjs");
    expect(pkg.scripts.build).toContain("--outfile=dist/index.js");
  });

  it("lists `types` first in exports, which TypeScript needs to find the declarations", () => {
    expect(Object.keys(pkg.exports["."])[0]).toBe("types");
  });

  it("rebuilds and checks the bundles before every publish", () => {
    expect(pkg.scripts.prepublishOnly).toBe("npm run build");
    expect(pkg.scripts.build).toContain("check-dist.mjs");
  });
});

// @vhyxvoid/agent has the same shape: its bundles (dist/cli.js, dist/AgentClient.js,
// the two files package.json points at) inline @vhyxvoid/protocol, so protocol is
// a build input. Found while preparing the 1.0.19 publish: with protocol under
// `dependencies` as `workspace:*`, `npm publish` produced a tarball that
// `npm install` rejects with EUNSUPPORTEDPROTOCOL. (The published sdk still has
// protocol as a real runtime dependency, because its dist is not bundled; that
// is a separate publish and is deliberately not covered here.)
describe("packages/agent manifest", () => {
  const pkg = readJson("packages/agent/package.json");

  it("declares no workspace: protocol version under dependencies (unpublishable with npm)", () => {
    for (const [name, range] of Object.entries<string>(pkg.dependencies ?? {})) {
      expect(range, `${name} in dependencies`).not.toMatch(/^workspace:/);
    }
  });

  it("keeps @vhyxvoid/protocol as a build-time devDependency, since the bundles inline it", () => {
    expect(pkg.dependencies?.["@vhyxvoid/protocol"]).toBeUndefined();
    expect(pkg.devDependencies?.["@vhyxvoid/protocol"]).toBeDefined();
  });
});

describe("agent: better-sqlite3 stays a lazy, declared dependency", () => {
  it("is declared by @vhyxvoid/agent itself (the package that really uses the queue)", () => {
    expect(readJson("packages/agent/package.json").dependencies["better-sqlite3"]).toBeDefined();
  });

  it("DurableQueue does not require better-sqlite3 at module load", () => {
    const src = fs.readFileSync(path.join(root, "packages/agent/src/queue/DurableQueue.ts"), "utf8");
    // `import type` is erased; a value import/require at top level is not.
    expect(src).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']better-sqlite3["']/m);
    expect(src).not.toMatch(/^(const|let|var)\s+[^=]*=\s*require\(["']better-sqlite3["']\)/m);
  });
});
