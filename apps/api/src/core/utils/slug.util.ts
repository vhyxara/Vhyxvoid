// src/core/utils/slug.util.ts
//
// Generates URL-safe slugs for account subdomains.
// Rules:
//   - Lowercase letters, numbers, hyphens only
//   - Max 32 chars
//   - No leading or trailing hyphens
//   - Globally unique — caller must verify and append suffix if taken

/**
 * Convert any string into a URL-safe slug.
 *
 * "Tanveer's Workspace" → "tanveers-workspace"
 * "Acme Corp 2"         → "acme-corp-2"
 * "My App!!!"           → "my-app"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD") // decompose accented chars
    .replace(/[\u0300-\u036f]/g, "") // strip accent marks
    .replace(/[^a-z0-9\s-]/g, "") // keep only letters, numbers, spaces, hyphens
    .trim()
    .replace(/[\s_]+/g, "-") // spaces and underscores → hyphens
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "") // strip leading/trailing hyphens
    .slice(0, 32); // max 32 chars
}

/**
 * Generate a slug with a random 4-char suffix for deduplication.
 *
 * "my-app" → "my-app-a3f9"
 */
export function slugifyWithSuffix(input: string): string {
  const base = slugify(input).slice(0, 27); // leave room for -xxxx
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

/**
 * Validate that a slug is safe to use as a subdomain segment.
 */
export function isValidSlug(slug: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug)
  ); // single char edge case
}
