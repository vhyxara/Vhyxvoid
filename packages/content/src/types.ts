// Shapes of website content. apps/api validates them with zod
// (modules/platform/content/content.schemas.ts); apps/web renders them.

export type ContentKind = "landing" | "pricing" | "page" | "footer";

export type Link = { label: string; href: string };

export type LandingContent = {
  hero: { eyebrow: string; title: string; subtitle: string; primaryCta: Link; secondaryCta?: Partial<Link>; terminal: string[] };
  stats: Array<{ value: string; label: string }>;
  features: { title: string; subtitle: string; items: Array<{ icon: string; title: string; body: string }> };
  steps: { title: string; items: Array<{ title: string; body: string; code: string }> };
  diagram?: { title: string; subtitle: string; source: string };
  useCases?: { title: string; items: Array<{ title: string; body: string }> };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  cta: { title: string; subtitle: string; primaryCta: Link };
};

export type PricingPlanContent = {
  plan: "FREE" | "PRO" | "ENTERPRISE";
  name: string;
  price: string;
  period: string;
  description: string;
  highlighted: boolean;
  ctaLabel: string;
  ctaHref: string;
  features: string[];
};

export type PricingContent = {
  title: string;
  subtitle: string;
  plans: PricingPlanContent[];
  faq: Array<{ q: string; a: string }>;
};

export type PageContent = {
  body: string;
  showInFooter: boolean;
  footerGroup: "product" | "company" | "legal";
};

/** One footer link as the admin edits it: a CMS page (by slug) or any URL. */
export type FooterLinkContent = {
  id: string;
  label: string;
  type: "page" | "url";
  /** type "page": the page's slug. */
  slug?: string;
  /** type "url": an https:// URL, a site path ("/pricing", "/#features") or mailto:. */
  href?: string;
  newTab?: boolean;
};

export type FooterColumnContent = { id: string; title: string; links: FooterLinkContent[] };

/** The "footer" entry (slug "footer"): columns of links, in display order. */
export type FooterContent = { columns: FooterColumnContent[] };

/** The footer as the site renders it: page links resolved, unpublished pages dropped. */
export type FooterMenu = {
  columns: Array<{ title: string; links: Array<{ label: string; href: string; external: boolean }> }>;
  /** false: no footer has been published yet; this is the built-in footer. */
  custom: boolean;
};

/** Slug of the footer entry. */
export const FOOTER_SLUG = "footer";

/**
 * A line holding only this in a page's markdown renders the contact form
 * there. (The admin editor's "Contact form" button inserts it.)
 */
export const CONTACT_FORM_MARKER = "{{contact-form}}";

/**
 * First path segments a page slug can't start with: the website's own routes
 * and locales. Pages are served at /<slug>, after every real route, so a page
 * could never hide one, but a slug here would never be reachable.
 */
export const RESERVED_PAGE_SLUGS = [
  "api", "api-docs", "api-docs-host", "blog", "dashboard", "docs", "en", "footer", "forgot-password", "fr", "home", "invitations", "login", "organizations", "p",
  "pricing", "profile", "register", "reset-password", "support", "verify-email", "verify-email-sent", "_next",
] as const;

export function isReservedPageSlug(slug: string): boolean {
  return (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug.split("/")[0].toLowerCase());
}

/** The site path of a page. */
export const pagePath = (slug: string) => `/${slug}`;

/** What GET /api/v1/public/content/:slug returns. */
export type PublishedContent<T = unknown> = {
  slug: string;
  kind: ContentKind;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  data: T;
  publishedAt: string | null;
  isDefault: boolean;
};
