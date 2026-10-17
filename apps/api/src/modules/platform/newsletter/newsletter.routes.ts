// The newsletter: sign-ups from the website (footer and blog), with double
// opt-in, and blog posts emailed to confirmed subscribers.
//
//   POST   /api/v1/public/newsletter               { email, source } → always 202 (never says whether the address is known)
//   POST   /api/v1/public/newsletter/confirm       { token } → CONFIRMED
//   POST   /api/v1/public/newsletter/unsubscribe   { token } or ?token= (RFC 8058 one-click) → UNSUBSCRIBED
//   GET    /api/v1/admin/newsletter                list (newsletter.read; ?status, ?search) + counts
//   GET    /api/v1/admin/newsletter/export.csv     confirmed subscribers (newsletter.read)
//   DELETE /api/v1/admin/newsletter/:id            forget a subscriber (newsletter.update)
//   POST   /api/v1/admin/newsletter/posts/:id/send { test? } email a live post (newsletter.send); once per post
//
// Links carry signed tokens (no token column): confirm links expire after 7
// days, unsubscribe links never do. Confirmation emails to one address go out
// at most once every 10 minutes, so the form can't be used to flood an inbox.
import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { buildEmailService } from "@/modules/notification/infrastructure/email/ResendEmailService";
import { newsletterConfirm, newsletterPost } from "@/modules/notification/infrastructure/email/templates";
import type { IEmailService } from "@/modules/notification/domain/services/IEmailService.notification";
import { csvCell } from "../activity/activity.routes";
import { excerptOf, postState } from "../blog/blog.service";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { pepper } from "../specs/specDocs";

const CONFIRM_DAYS = 7;
const RESEND_AFTER_MS = 10 * 60_000;

let mailer: IEmailService | null = null;
const email = () => (mailer ??= buildEmailService());
/** Tests replace the email service and the pause between newsletter emails. */
export function setNewsletterMailer(m: IEmailService | null, gapMs?: number) {
  mailer = m;
  if (gapMs !== undefined) sendGapMs = gapMs;
}
// Resend allows a few requests a second; one email at a time, spaced out.
let sendGapMs = Number(process.env.NEWSLETTER_SEND_INTERVAL_MS ?? 600);

type Kind = "confirm" | "unsubscribe";
const sig = (kind: Kind, id: string, exp: number) => createHmac("sha256", `${pepper()}|newsletter`).update(`${kind}|${id}|${exp}`).digest("base64url").slice(0, 32);

/** "<id>.<exp>.<signature>"; exp 0 = never expires. */
export function newsletterToken(kind: Kind, id: string, now = Date.now()): string {
  const exp = kind === "confirm" ? Math.floor(now / 1000) + CONFIRM_DAYS * 86400 : 0;
  return `${id}.${exp}.${sig(kind, id, exp)}`;
}

export function readNewsletterToken(kind: Kind, token: string, now = Date.now()): string | null {
  const [id, e, s] = String(token).split(".");
  const exp = Number(e);
  if (!id || !s || !Number.isInteger(exp) || !z.string().uuid().safeParse(id).success) return null;
  const want = Buffer.from(sig(kind, id, exp));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (exp && exp * 1000 < now) return null;
  return id;
}

/** The website's public address, for links in emails. */
export async function siteUrl(fastify: FastifyInstance): Promise<string> {
  const set = String((await fastify.platformSettings.get("seo.siteUrl").catch(() => "")) || "");
  return (set || process.env.SITE_URL || process.env.APP_URL || "https://www.vhyxvoid.com").replace(/\/$/, "");
}

const absolute = (site: string, u: string | null) => (!u ? null : /^https?:\/\//.test(u) ? u : `${site}${u.startsWith("/") ? "" : "/"}${u}`);

async function sendConfirm(fastify: FastifyInstance, id: string, to: string) {
  const site = await siteUrl(fastify);
  const productName = String((await fastify.platformSettings.get("general.productName").catch(() => "")) || "");
  const msg = newsletterConfirm({ confirmUrl: `${site}/newsletter/confirm?token=${newsletterToken("confirm", id)}`, productName });
  await prismaOf(fastify).newsletterSubscriber.update({ where: { id }, data: { lastConfirmSentAt: new Date() } });
  void email()
    .send({ to, ...msg })
    .catch((err: Error) => console.error("[newsletter] confirmation email failed", err.message));
}

export async function publicNewsletterRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const body = z.object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
    source: z.string().trim().max(80).default(""),
    /** Honeypot: hidden from people, filled by bots. */
    website: z.string().max(200).optional(),
  });
  const done = (reply: Parameters<typeof successResponse>[0]) => successResponse(reply, "Check your inbox to confirm", 202, { ok: true });

  fastify.post("/", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const b = body.parse(request.body ?? {});
    if (!(await fastify.platformSettings.get("newsletter.enabled"))) throw new ServiceUnavailableError("Sign-ups are closed just now.");
    if (b.website) return done(reply);
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email: b.email } });
    if (existing?.status === "CONFIRMED") return done(reply);
    if (existing && existing.lastConfirmSentAt && Date.now() - existing.lastConfirmSentAt.getTime() < RESEND_AFTER_MS) return done(reply);
    const row = existing
      ? await prisma.newsletterSubscriber.update({ where: { id: existing.id }, data: { status: "PENDING", source: b.source || existing.source, ip: request.ip } })
      : await prisma.newsletterSubscriber.create({ data: { email: b.email, source: b.source, ip: request.ip } }).catch(async () => prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: b.email } }));
    await sendConfirm(fastify, row.id, row.email);
    return done(reply);
  });

  fastify.post("/confirm", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().max(200) }).parse(request.body ?? {});
    const id = readNewsletterToken("confirm", token);
    if (!id) throw new ValidationError("This link is wrong or has expired. Sign up again to get a new one.");
    const row = await prisma.newsletterSubscriber.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("This subscription no longer exists. Sign up again.");
    if (row.status !== "CONFIRMED") await prisma.newsletterSubscriber.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date(), unsubscribedAt: null } });
    return successResponse(reply, "Subscribed", 200, { email: row.email, status: "CONFIRMED" });
  });

  // From the page (JSON body) or a mail client's one-click button (form body, token in the query).
  fastify.post<{ Querystring: { token?: string } }>("/unsubscribe", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const fromBody = request.body && typeof request.body === "object" ? (request.body as { token?: unknown }).token : undefined;
    const id = readNewsletterToken("unsubscribe", String(fromBody ?? request.query?.token ?? ""));
    if (!id) throw new ValidationError("This unsubscribe link is wrong. Use the link in the latest email, or contact us.");
    const row = await prisma.newsletterSubscriber.findUnique({ where: { id } });
    // Already forgotten: nothing will be sent, which is what was asked.
    if (row && row.status !== "UNSUBSCRIBED") await prisma.newsletterSubscriber.update({ where: { id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
    return successResponse(reply, "Unsubscribed", 200, { email: row?.email ?? null, status: "UNSUBSCRIBED" });
  });

  // Mail clients' one-click unsubscribe posts application/x-www-form-urlencoded ("List-Unsubscribe=One-Click").
  if (!fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
    fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 }, (_req, b, done) => done(null, Object.fromEntries(new URLSearchParams(String(b)))));
  }
}

const statusSchema = z.enum(["PENDING", "CONFIRMED", "UNSUBSCRIBED"]);

export async function adminNewsletterRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  fastify.get("/", { onRequest: [fastify.requireAbility("newsletter.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: statusSchema.optional() }).parse(request.query);
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.search ? { email: { contains: q.search, mode: "insensitive" as const } } : {}) };
    const [items, total, grouped] = await Promise.all([
      prisma.newsletterSubscriber.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q), select: { id: true, email: true, status: true, source: true, confirmedAt: true, unsubscribedAt: true, createdAt: true } }),
      prisma.newsletterSubscriber.count({ where }),
      prisma.newsletterSubscriber.groupBy({ by: ["status"], _count: true }),
    ]);
    const counts = Object.fromEntries(statusSchema.options.map((s) => [s, grouped.find((g) => g.status === s)?._count ?? 0]));
    return page(items, total, q, { counts });
  });

  fastify.get("/export.csv", { onRequest: [fastify.requireAbility("newsletter.read")] }, async (request, reply) => {
    const rows = await prisma.newsletterSubscriber.findMany({ where: { status: "CONFIRMED" }, orderBy: { confirmedAt: "asc" }, take: 100_000, select: { email: true, source: true, confirmedAt: true, createdAt: true } });
    await audit(fastify, request, { action: "newsletter.exported", targetType: "NewsletterSubscriber", after: { rows: rows.length } });
    const lines = ["email,source,subscribedAt,confirmedAt", ...rows.map((r) => [r.email, r.source, r.createdAt.toISOString(), r.confirmedAt?.toISOString() ?? ""].map(csvCell).join(","))];
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="newsletter-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(lines.join("\n"));
  });

  fastify.delete("/:id", { onRequest: [fastify.requireAbility("newsletter.update")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await prisma.newsletterSubscriber.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Subscriber not found");
    await prisma.newsletterSubscriber.delete({ where: { id } });
    await audit(fastify, request, { action: "newsletter.subscriber_deleted", targetType: "NewsletterSubscriber", targetId: id, before: { email: row.email, status: row.status } });
    return successResponse(reply, "Deleted", 200, { id });
  });

  fastify.post("/posts/:id/send", { onRequest: [fastify.requireAbility("newsletter.send")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { test } = z.object({ test: z.boolean().default(false) }).parse(request.body ?? {});
    const post = await prisma.blogPost.findUnique({ where: { id }, select: { id: true, slug: true, title: true, excerpt: true, body: true, coverImageUrl: true, coverImageAlt: true, status: true, publishedAt: true, newsletterSentAt: true } });
    if (!post) throw new NotFoundError("Post not found");
    const site = await siteUrl(fastify);
    const productName = String((await fastify.platformSettings.get("general.productName").catch(() => "")) || "");
    const build = (unsubscribeUrl: string) =>
      newsletterPost({ title: post.title, excerpt: excerptOf(post), url: `${site}/blog/${post.slug}`, imageUrl: absolute(site, post.coverImageUrl), imageAlt: post.coverImageAlt, unsubscribeUrl, productName });

    if (test) {
      const admin = getAdminContext(request);
      const msg = build(`${site}/newsletter/unsubscribe`);
      await email().send({ to: admin.email, ...msg, subject: `[Test] ${msg.subject}` });
      return successResponse(reply, "Test sent", 200, { to: admin.email });
    }

    if (postState(post) !== "PUBLISHED") throw new ValidationError("Publish the post first: only live posts can be emailed.");
    // Claim the send: a post goes out once, even if two admins click at the same time.
    const claimed = await prisma.blogPost.updateMany({ where: { id, newsletterSentAt: null }, data: { newsletterSentAt: new Date() } });
    if (!claimed.count) throw new ConflictError("This post was already emailed to subscribers.");
    const recipients = await prisma.newsletterSubscriber.count({ where: { status: "CONFIRMED" } });
    await audit(fastify, request, { action: "newsletter.post_sent", targetType: "BlogPost", targetId: id, after: { recipients, title: post.title } });

    void (async () => {
      let cursor: string | undefined;
      let sent = 0;
      let failed = 0;
      for (;;) {
        const batch = await prisma.newsletterSubscriber.findMany({ where: { status: "CONFIRMED" }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, email: true } });
        if (!batch.length) break;
        for (const s of batch) {
          const token = newsletterToken("unsubscribe", s.id);
          const unsubscribeUrl = `${site}/newsletter/unsubscribe?token=${token}`;
          try {
            await email().send({
              to: s.email,
              ...build(unsubscribeUrl),
              headers: { "List-Unsubscribe": `<${site}/api/newsletter/unsubscribe?token=${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
            });
            sent++;
          } catch (err) {
            failed++;
            console.error("[newsletter] send failed", s.id, (err as Error).message);
          }
          if (sendGapMs) await new Promise((r) => setTimeout(r, sendGapMs));
        }
        cursor = batch[batch.length - 1].id;
      }
      console.info(`[newsletter] post ${id}: ${sent} sent, ${failed} failed`);
    })().catch((err: Error) => console.error("[newsletter] send stopped", err.message));

    return successResponse(reply, "Sending", 202, { recipients });
  });
}
