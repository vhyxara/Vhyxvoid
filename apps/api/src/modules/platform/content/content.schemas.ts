// Shapes of website content edited in the admin panel. Each `kind` has a
// schema; the admin UI renders a form per kind and the public site renders
// published data of the same shape (apps/web/src/views/marketing).
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const link = z.object({ label: text(40), href: text(300) });
const optionalLink = link.partial().optional();
/** An image address: https://… or a path on the site (/media/…). */
const imageUrl = (required: boolean) =>
  text(500).refine((v) => (!required && v === "") || /^https:\/\/\S+$/.test(v) || /^\/[^/\s]\S*$/.test(v), required ? "Choose an image, or use an https:// address or a path on the site" : "Use an https:// address or a path on the site");

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
  journey: z
    .object({
      title: text(120),
      subtitle: text(400).default(""),
      stages: z.array(z.object({ node: text(20), title: text(80), body: text(400) })).min(2).max(8),
    })
    .optional(),
  diagram: z
    .object({ title: text(120), subtitle: text(300).default(""), source: text(4000) })
    .optional(),
  useCases: z
    .object({ title: text(120), items: z.array(z.object({ title: text(80), body: text(300) })).max(9) })
    .optional(),
  logos: z
    .object({ title: text(120).default(""), items: z.array(z.object({ name: text(80), imageUrl: imageUrl(true), href: text(300).default("") })).max(24) })
    .optional(),
  showcase: z
    .object({
      title: text(120).default(""),
      subtitle: text(300).default(""),
      videoUrl: text(500)
        .default("")
        .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "Use an https:// address: a YouTube or Vimeo link, or a video file"),
      images: z.array(z.object({ imageUrl: imageUrl(true), alt: text(200).default(""), caption: text(200).default("") })).max(8),
    })
    .optional(),
  testimonials: z
    .object({ title: text(120).default(""), items: z.array(z.object({ quote: text(600), name: text(80), role: text(120).default(""), avatarUrl: imageUrl(false).default("") })).max(12) })
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
  /** Markdown. Rendered with a safe subset (no raw HTML). A line holding only
   * {{contact-form}} renders the contact form there. */
  body: z.string().max(100_000),
  /** Used only until a footer menu is published (the built-in footer). */
  showInFooter: z.boolean().default(false),
  footerGroup: z.enum(["product", "company", "legal"]).default("legal"),
});

// A footer link's href: an http(s) URL, mailto:, or a path on this site
// ("/pricing", "/#features"). "//host" and "/\host" are other sites to a
// browser, so they are refused as paths.
const footerHref = text(500).refine((v) => /^(https?:\/\/[^\s]+|mailto:[^\s]+|\/(?![\/\\])[^\s]*)$/i.test(v), "Use https://…, mailto:… or a path starting with /");
const itemId = z.string().trim().min(1).max(40);

export const footerSchema = z.object({
  columns: z
    .array(
      z.object({
        id: itemId,
        title: text(40),
        links: z
          .array(
            z
              .object({
                id: itemId,
                label: text(60).min(1, "Give the link a label"),
                type: z.enum(["page", "url"]),
                slug: text(80).optional(),
                href: footerHref.optional(),
                newTab: z.boolean().default(false),
              })
              .superRefine((l, ctx) => {
                if (l.type === "page" && !l.slug) ctx.addIssue({ code: "custom", path: ["slug"], message: "Pick a page" });
                if (l.type === "url" && !l.href) ctx.addIssue({ code: "custom", path: ["href"], message: "Enter a URL" });
              }),
          )
          .max(12),
      }),
    )
    .max(6),
});

export const CONTENT_KINDS = {
  landing: { label: "Landing page", schema: landingSchema },
  pricing: { label: "Pricing page", schema: pricingSchema },
  page: { label: "Page (markdown)", schema: pageSchema },
  footer: { label: "Footer menu", schema: footerSchema },
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
