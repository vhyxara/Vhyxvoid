#!/usr/bin/env node
// scripts/pack-packages.mjs — build the four public packages from this repo and
// pack them as npm tarballs, without publishing anything.
//
// Until @vhyxvoid/agent, sdk, middleware and next are published together, use
// these tarballs wherever the published versions would be used:
//   npm install ./.packs/vhyxvoid-agent-1.1.0.tgz
//   npx --package=./.packs/vhyxvoid-agent-1.1.0.tgz vhyxvoid start …
//   actions/tunnel: `agent-package: ./.packs/vhyxvoid-agent-1.1.0.tgz`
// CI uploads the same files as the `vhyxvoid-packages` artifact on every run.
//
// Usage: node scripts/pack-packages.mjs [output dir, default .packs]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] ?? ".packs");
const packages = ["agent", "sdk", "middleware", "next"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

// turbo builds what each package depends on (protocol, shared) first.
run("pnpm", ["turbo", "run", "build", ...packages.map((p) => `--filter=@vhyxvoid/${p}`)]);

const made = [];
for (const p of packages) {
  const dir = path.join(root, "packages", p);
  // pnpm pack rewrites workspace: dependencies to real versions, like publish does.
  run("pnpm", ["pack", "--pack-destination", out], dir);
  const { name, version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
  const full = path.join(out, file);
  if (!fs.existsSync(full)) throw new Error(`expected ${full} after pnpm pack`);
  const sha = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
  made.push({ name, version, file: path.relative(root, full), sha256: sha });
}

fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ commit: run("git", ["rev-parse", "--short", "HEAD"]).trim(), packages: made }, null, 2) + "\n");
for (const m of made) console.log(`${m.name}@${m.version}  ${m.file}  sha256:${m.sha256.slice(0, 16)}…`);
