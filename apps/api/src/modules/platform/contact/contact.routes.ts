// The website's contact form (a {{contact-form}} block on a CMS page).
//
//   POST   /api/v1/public/contact              send a message (public; 5 per 10 min per address)
//   GET    /api/v1/admin/contact-messages      list (contact.read; ?status=NEW|READ|ARCHIVED, ?search)
//   GET    /api/v1/admin/contact-messages/:id  one message (contact.read)
//   PATCH  /api/v1/admin/contact-messages/:id  { status } (contact.update)
//   DELETE /api/v1/admin/contact-messages/:id  (contact.update)
//
// Each message is stored and emailed to the support email setting, with the
// sender as Reply-To. Spam: a hidden "website" field that people never fill
// (a filled one is answered as if sent and dropped), the rate limit, and a
// Cloudflare Turnstile captcha when TURNSTILE_SECRET_KEY is set (captcha.ts).
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { NotFoundError, ServiceUnavailableError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { buildEmailService } from "@/modules/notification/infrastructure/email/ResendEmailService";
import { escapeHtml } from "@/modules/notification/infrastructure/email/templates";
import type { IEmailService } from "@/modules/notification/domain/services/IEmailService.notification";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { verifyCaptcha } from "./captcha";

export const contactBody = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(200),
  subject: z.string().trim().max(150).default(""),
  message: z.string().trim().min(10, "Write at least a sentence").max(5000),
  page: z.string().trim().max(80).default(""),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(200).optional(),
  /** Cloudflare Turnstile token (captcha.ts); required when TURNSTILE_SECRET_KEY is set. */
  captchaToken: z.string().max(4096).optional(),
});

let mailer: IEmailService | null = null;
const email = () => (mailer ??= buildEmailService());
/** Tests replace the email service. */
export function setContactMailer(m: IEmailService | null) {
  mailer = m;
}

export async function publicContactRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  fastify.post("/contact", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const b = contactBody.parse(request.body ?? {});
    if (!(await fastify.platformSettings.get("support.contactForm"))) throw new ServiceUnavailableError("The contact form is switched off. Email us instead.");
    // Bots fill every field; people never see this one. Answer as if sent.
    if (b.website) return successResponse(reply, "Message sent", 202, { id: null });
    const captcha = await verifyCaptcha(b.captchaToken, request.ip);
    if (!captcha.ok) {
      if (captcha.reason === "unavailable") throw new ServiceUnavailableError("We couldn't check that you're human just now. Try again in a minute.");
      throw new ValidationError(captcha.reason === "missing" ? "Complete the check that you're human, then send again." : "The check that you're human failed or expired. Try it again, then send.");
    }
    const row = await prisma.contactMessage.create({
      data: { name: b.name, email: b.email, subject: b.subject, message: b.message, page: b.page, ip: request.ip, userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300) },
    });
    const to = String((await fastify.platformSettings.get("support.email")) || "");
    if (to) {
      const subject = `Contact form: ${b.subject || b.name}`.slice(0, 160);
      const text = `From: ${b.name} <${b.email}>\nPage: /${b.page}\n\n${b.message}`;
      const html = `<p><strong>From:</strong> ${escapeHtml(b.name)} &lt;${escapeHtml(b.email)}&gt;<br><strong>Page:</strong> /${escapeHtml(b.page)}</p><p style="white-space:pre-wrap">${escapeHtml(b.message)}</p>`;
      void email()
        .send({ to, subject, text, html, replyTo: b.email })
        .catch((err: Error) => console.error("[contact] email to support failed", err.message));
    }
    return successResponse(reply, "Message sent", 202, { id: row.id });
  });
}

export async function adminContactRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const idParams = z.object({ id: z.string().uuid() });
  const status = z.enum(["NEW", "READ", "ARCHIVED"]);

  fastify.get("/", { onRequest: [fastify.requireAbility("contact.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: status.optional() }).parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : { status: { not: "ARCHIVED" as const } }),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { email: { contains: q.search, mode: "insensitive" as const } }, { subject: { contains: q.search, mode: "insensitive" as const } }, { message: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total, unread] = await Promise.all([
      prisma.contactMessage.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q) }),
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.count({ where: { status: "NEW" } }),
    ]);
    return page(items, total, q, { unread });
  });

  fastify.get("/:id", { onRequest: [fastify.requireAbility("contact.read")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const row = await prisma.contactMessage.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Message not found");
    return successResponse(reply, "Success", 200, row);
  });

  fastify.patch("/:id", { onRequest: [fastify.requireAbility("contact.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = z.object({ status }).parse(request.body ?? {});
    const before = await prisma.contactMessage.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Message not found");
    const row = await prisma.contactMessage.update({ where: { id }, data: { status: b.status } });
    await audit(fastify, request, { action: "contact.status_changed", targetType: "ContactMessage", targetId: id, before: { status: before.status }, after: { status: row.status } });
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/:id", { onRequest: [fastify.requireAbility("contact.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await prisma.contactMessage.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Message not found");
    await prisma.contactMessage.delete({ where: { id } });
    await audit(fastify, request, { action: "contact.deleted", targetType: "ContactMessage", targetId: id, before: { email: before.email, subject: before.subject } });
    return successResponse(reply, "Deleted", 200, { id });
  });
}
