// SEO rules shared by the API (validation, audit), the admin panel (previews)
// and the website (metadata, redirects): one definition of a site path, a
// redirect match, a page title, and the website's fixed public routes.

/** Lengths search engines show; longer text is cut off in results. */
export const SEO_LIMITS = { title: 60, description: 160, descriptionMin: 50 } as const;

/**
 * The website's own public routes (not CMS pages or blog posts), with the
 * title and description they use when the SEO screen sets none. Home and
 * pricing take theirs from Website content first.
 */
export const SITE_ROUTES: ReadonlyArray<{ path: string; label: string; title: string; description: string; content?: string }> = [
  { path: "/", label: "Home", title: "", description: "", content: "home" },
  { path: "/pricing", label: "Pricing", title: "Pricing", description: "Plans and prices: start free and upgrade when you need more tunnels, requests and team members.", content: "pricing" },
  { path: "/blog", label: "Blog", title: "Blog", description: "News, guides and updates from the team." },
  { path: "/changelog", label: "Changelog", title: "Changelog", description: "What's new: every release, with its new features, improvements and fixes." },
  { path: "/support", label: "Support", title: "Support", description: "Get help: documentation, the status page and how to reach the team." },
  { path: "/login", label: "Sign in", title: "Sign in", description: "Sign in to your account." },
  { path: "/register", label: "Create an account", title: "Create an account", description: "Create a free account and share your localhost in seconds." },
];

/**
 * A site path in its one canonical form: leading "/", no trailing "/" (except
 * the root), no query or fragment, no repeated slashes. null when it isn't a
 * path at all (a URL, spaces, "..", control characters).
 */
export function normalizeSitePath(input: string): string | null {
  let p = input.trim();
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  p = p.replace(/[?#].*$/, "");
  if (/[\s\\<>"'`]|\.\.|[\u0000-\u001f\u007f]/.test(p)) return null;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.length <= 300 ? p || "/" : null;
}

export type RedirectRule = { from: string; to: string; permanent: boolean };

/**
 * The redirect for a path: an exact rule first, then the longest "/*" rule
 * that covers it. A "/*" target keeps the rest of the path
 * ("/docs/*" → "/guides/*" sends /docs/a/b to /guides/a/b).
 */
export function resolveRedirect(rules: readonly RedirectRule[], path: string): { to: string; permanent: boolean; from: string } | null {
  const exact = rules.find((r) => r.from === path);
  if (exact) return { to: exact.to, permanent: exact.permanent, from: exact.from };
  let best: RedirectRule | null = null;
  for (const r of rules) {
    if (!r.from.endsWith("/*")) continue;
    const base = r.from.slice(0, -2);
    if ((path === base || path.startsWith(`${base}/`)) && (!best || r.from.length > best.from.length)) best = r;
  }
  if (!best) return null;
  const rest = path.slice(best.from.length - 2);
  const to = best.to.endsWith("/*") ? `${best.to.slice(0, -2)}${rest}` || "/" : best.to;
  return { to, permanent: best.permanent, from: best.from };
}

/** "%s — Acme" applied to a page title; an empty template means "%s — <product>". */
export function applyTitleTemplate(title: string, template: string, productName: string): string {
  const t = template.includes("%s") ? template : `%s — ${productName}`;
  return title ? t.replace("%s", title) : productName;
}

/** Profiles for schema.org sameAs: one https URL per line, plus extras, deduplicated. */
export function profileUrls(lines: string, ...extra: Array<string | undefined>): string[] {
  return [...new Set([...extra, ...lines.split(/\n/)].map((l) => (l ?? "").trim()).filter((l) => /^https:\/\/\S+$/.test(l)))];
}
