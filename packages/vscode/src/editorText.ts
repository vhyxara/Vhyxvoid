// Pure helpers for the extension (no vscode import, tested in
// tests/e2e/vscodeExtension.test.ts): where a spec problem or change sits in
// the file, which spec a file is linked to, and how a run report reads.

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** "paths./users/{id}.get.parameters[0].name" -> ["paths", "/users/{id}", "get", "parameters", "name"]. */
export function problemSegments(path: string): string[] {
  if (!path) return [];
  if (path.startsWith("paths.")) {
    const rest = path.slice(6);
    const m = rest.match(new RegExp(`^(.*?)\\.(${METHODS.join("|")})(\\.(.*))?$`));
    if (m) return ["paths", m[1]!, m[2]!, ...splitDots(m[4] ?? "")];
    return ["paths", rest];
  }
  return splitDots(path);
}

function splitDots(s: string): string[] {
  return s
    .split(".")
    .map((x) => x.replace(/\[\d+\]$/, ""))
    .filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * Best-effort 0-based line of a key path in YAML or pretty-printed JSON:
 * each segment is looked for below the previous one, deeper indented. Stops
 * at the deepest segment found, so a problem always lands somewhere sensible.
 */
export function locateSegments(text: string, segments: readonly string[]): number {
  const lines = text.split(/\r?\n/);
  let at = 0;
  let indent = -1;
  let found = false;
  for (const seg of segments) {
    const key = new RegExp(`^\\s*(?:-\\s+)?(?:"${escapeRe(seg)}"|'${escapeRe(seg)}'|${escapeRe(seg)})\\s*:`);
    let hit = -1;
    for (let i = found ? at + 1 : 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      // Left the parent block: stop looking.
      if (found && indentOf(line) <= indent && !/^\s*[}\]],?\s*$/.test(line)) break;
      if (key.test(line) && indentOf(line) > indent) {
        hit = i;
        break;
      }
    }
    if (hit < 0) break;
    at = hit;
    indent = indentOf(lines[hit]!);
    found = true;
  }
  return found ? at : 0;
}

export function locateProblem(text: string, path: string): number {
  return locateSegments(text, problemSegments(path));
}

/** A change location ("GET /users/{id}", "GET /users/{id} response 200", "components.schemas.User") -> line. */
export function locateChange(text: string, location: string): number {
  const op = location.match(/^([A-Z]+)\s+(\/\S*)/);
  if (op) return locateSegments(text, ["paths", op[2]!, op[1]!.toLowerCase()]);
  return locateSegments(text, splitDots(location));
}

/** The spec a workspace-relative file is linked to (vhyxvoid.specs), matching paths with either slash. */
export function specRefFor(mapping: Record<string, string> | undefined, relPath: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const want = norm(relPath);
  for (const [file, ref] of Object.entries(mapping ?? {})) if (norm(file) === want && ref.trim()) return ref.trim();
  return null;
}

/** True when the text looks like an OpenAPI / Swagger document. */
export function looksLikeSpec(text: string): boolean {
  return /^\s*["']?(openapi|swagger)["']?\s*:/m.test(text.slice(0, 4000));
}

type ReportLike = {
  collection: string;
  environment?: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  results: Array<{ name: string; method: string; url: string; status?: number; timeMs?: number; outcome: string; error?: string; assertions: Array<{ pass: boolean; label: string; message: string }> }>;
};

/** A run report as output-channel lines. */
export function reportLines(r: ReportLike): string[] {
  const icon: Record<string, string> = { passed: "✓", failed: "✗", errored: "!", skipped: "-" };
  const out = [`${r.collection}${r.environment ? ` (${r.environment})` : ""}`, ""];
  for (const x of r.results) {
    out.push(`${icon[x.outcome] ?? "?"} ${x.method} ${x.name}${x.status !== undefined ? `  ${x.status}` : ""}${x.timeMs !== undefined ? `  ${x.timeMs} ms` : ""}`);
    if (x.error) out.push(`    ${x.error}`);
    for (const a of x.assertions) if (!a.pass) out.push(`    ✗ ${a.label}: ${a.message}`);
  }
  out.push("", `${r.passed} passed, ${r.failed} failed${r.errored ? `, ${r.errored} errored` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""} of ${r.total} in ${(r.durationMs / 1000).toFixed(1)} s`);
  return out;
}
