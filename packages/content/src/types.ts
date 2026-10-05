// Shapes of website content. apps/api validates them with zod
// (modules/platform/content/content.schemas.ts); apps/web renders them.

export type ContentKind = "landing" | "pricing" | "page";

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
