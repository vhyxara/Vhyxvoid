// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

export function roleLevelName(level: number): string {
  if (level >= 100) return "OWNER";
  if (level >= 70) return "ADMIN";
  return "MEMBER";
}
