// scripts/check-links.mjs — run after `next build`.
//
// Checks every internal link in the built pages: the target page exists and,
// for `#anchor` links, the heading id exists on it. Content links are written
// root-relative (`/limitations`, not `/docs/limitations`): next.config.mjs sets
// basePath '/docs' and Next's <Link> adds it, so a `/docs/...` link in content
// renders as `/docs/docs/...` and 404s. That shipped once (2026-10-06).
//
// Usage: node scripts/check-links.mjs [path to .next/server/app]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, "..", ".next", "server", "app"));
if (!fs.existsSync(root)) {
  console.error(`[check:links] ${root} not found: run \`pnpm --filter @vhyxvoid/docs build\` first`);
  process.exit(1);
}

const pages = new Map();
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".html")) {
      const rel = path.relative(root, p).replace(/\.html$/, "").replace(/(^|\/)index$/, "");
      pages.set("/" + rel, fs.readFileSync(p, "utf8"));
    }
  }
};
walk(root);

const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const problems = new Set();
for (const [page, html] of pages) {
  if (page.startsWith("/_")) continue;
  for (const m of html.matchAll(/href="(\/docs(?!\/_next)[^"]*)"/g)) {
    const [rawPath, hash] = m[1].replace(/^\/docs/, "").split("#");
    const p = rawPath.replace(/\/$/, "") || "/";
    const target = p === "/" ? (pages.get("/") ?? pages.get("")) : pages.get(p);
    if (!target) problems.add(`${page}: ${m[1]} (no such page)`);
    else if (hash && !idsOf(target).has(decodeURIComponent(hash))) problems.add(`${page}: ${m[1]} (no such anchor)`);
  }
}

if (problems.size) {
  console.error([...problems].join("\n"));
  console.error(`[check:links] ${problems.size} broken link(s) in ${pages.size} pages`);
  process.exit(1);
}
console.log(`[check:links] ${pages.size} pages, all internal links ok`);
