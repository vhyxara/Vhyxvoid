// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/path.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True only for an origin-form request path: a single leading "/" followed
 * by anything but another "/" or "\". Every tunnel:forward path must pass
 * this before the agent resolves it against its local backend.
 *
 * The agent builds `http://127.0.0.1:<port>` + path, and axios ignores the
 * base URL for an absolute path, so `http://169.254.169.254/…`, `//host/…`
 * (protocol-relative) or `/\host/…` (which WHATWG URL parsing reads as
 * `//host`) would make the developer's machine fetch another host (audit
 * H9). Checked at the hub (sdk:request and the public HTTP path) and again
 * at the agent.
 */
export function isOriginFormPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    path[1] !== "/" &&
    path[1] !== "\\"
  );
}
