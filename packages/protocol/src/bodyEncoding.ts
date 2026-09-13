// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/bodyEncoding.ts
// Single source of truth for "is this content-type binary" — used by every
// place in the system that has to decide whether a body needs base64
// (bodyEncoding: 'base64') instead of being sent as plain utf8 text.
//
// Previously reimplemented independently in four places (BackendProxy,
// HttpTunnelHandler, LocalAgentClient, client.ts) with the same list,
// discovered while fixing the request-direction half of context.md risk
// #21 — consolidated here since this package is already the documented
// single source of truth for the protocol and all four call sites already
// depend on it.
// ─────────────────────────────────────────────────────────────────────────────

export function isBinaryContentType(contentType: string | string[] | undefined): boolean {
  const ct = (Array.isArray(contentType) ? contentType[0] : (contentType ?? "")).toLowerCase();
  return (
    ct.includes("image/") ||
    ct.includes("application/pdf") ||
    ct.includes("application/octet-stream") ||
    ct.includes("audio/") ||
    ct.includes("video/") ||
    ct.includes("font/") ||
    ct.includes("application/zip")
  );
}
