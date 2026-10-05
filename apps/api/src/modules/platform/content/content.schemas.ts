// Shapes of website content edited in the admin panel. Each `kind` has a
// schema; the admin UI renders a form per kind and the public site renders
// published data of the same shape (apps/web/src/views/marketing).
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const link = z.object({ label: text(40), href: text(300) });
const optionalLink = link.partial().optional();

export const landingSchema = z.object({
  hero: z.object({
    eyebrow: text(80).default(""),
    title: text(120),
    subtitle: text(400),
    primaryCta: link,
    secondaryCta: optionalLink,
    terminal: z.array(text(200)).max(12).default([]),
  }),
  stats: z.array(z.object({ value: text(20), label: text(60) })).max(6).default([]),
  features: z.object({
    title: text(120),
    subtitle: text(300).default(""),
    items: z.array(z.object({ icon: text(40).default(""), title: text(80), body: text(400) })).max(12),
  }),
  steps: z.object({
    title: text(120),
    items: z.array(z.object({ title: text(80), body: text(300), code: text(400).default("") })).max(6),
  }),
  diagram: z
    .object({ title: text(120), subtitle: text(300).default(""), source: text(4000) })
    .optional(),
  useCases: z
    .object({ title: text(120), items: z.array(z.object({ title: text(80), body: text(300) })).max(9) })
    .optional(),
  faq: z.object({ title: text(120), items: z.array(z.object({ q: text(200), a: text(1500) })).max(20) }),
  cta: z.object({ title: text(120), subtitle: text(300).default(""), primaryCta: link }),
});

export const pricingSchema = z.object({
  title: text(120),
  subtitle: text(300).default(""),
  plans: z
    .array(
      z.object({
        plan: z.enum(["FREE", "PRO", "ENTERPRISE"]),
        name: text(40),
        price: text(20),
        period: text(30).default(""),
        description: text(200).default(""),
        highlighted: z.boolean().default(false),
        ctaLabel: text(40),
        ctaHref: text(300).default(""),
        features: z.array(text(120)).max(20),
      }),
    )
    .max(4),
  faq: z.array(z.object({ q: text(200), a: text(1500) })).max(20).default([]),
});

export const pageSchema = z.object({
  /** Markdown. Rendered with a safe subset (no raw HTML). */
  body: z.string().max(100_000),
  showInFooter: z.boolean().default(false),
  footerGroup: z.enum(["product", "company", "legal"]).default("legal"),
});

export const CONTENT_KINDS = {
  landing: { label: "Landing page", schema: landingSchema },
  pricing: { label: "Pricing page", schema: pricingSchema },
  page: { label: "Page (markdown)", schema: pageSchema },
} as const;

export type ContentKind = keyof typeof CONTENT_KINDS;

export function isContentKind(kind: string): kind is ContentKind {
  return Object.prototype.hasOwnProperty.call(CONTENT_KINDS, kind);
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/, "Use lowercase letters, digits, - and /")
  .max(80);
