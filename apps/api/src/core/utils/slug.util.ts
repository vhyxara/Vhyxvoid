// src/core/utils/slug.util.ts
//
// Generates URL-safe slugs for account subdomains.
// Rules:
//   - Lowercase letters, numbers, hyphens only
//   - Max 32 chars
//   - No leading or trailing hyphens
//   - Globally unique — caller must verify, and regenerate if taken

import { randomInt } from "crypto";

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

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const SLUG_SUFFIX_LENGTH = 8; // ~41 bits
const SLUG_MAX_LENGTH = 32;

/**
 * The slug for a new account: its public tunnel host is
 * <slug>--<label>.<hubDomain>, so it must not be guessable from the name
 * (audit H11). A readable prefix from the name, plus a random suffix that is
 * ALWAYS present, not only on collision:
 *
 * "Acme Corp"          → "acme-corp-k3x9p2qa"
 * "John's Workspace"   → "johns-workspace-7fq2m0zd"
 * "株式会社" (no ASCII) → "workspace-p81xw3nc"  (an empty prefix would give an
 *                                                invalid leading "-")
 *
 * Callers still check uniqueness and call this again on a (now only random)
 * collision.
 */
export function generateAccountSlug(name: string | null | undefined): string {
  const prefix =
    slugify(name ?? "")
      .slice(0, SLUG_MAX_LENGTH - 1 - SLUG_SUFFIX_LENGTH)
      .replace(/-+$/, "") || "workspace";
  let suffix = "";
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

/**
 * Validate that a slug is safe to use as a subdomain segment.
 */
export function isValidSlug(slug: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug)
  ); // single char edge case
}
