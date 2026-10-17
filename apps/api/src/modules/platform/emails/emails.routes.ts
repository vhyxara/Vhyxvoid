// /api/v1/admin/emails — the wording of the emails listed in packages/shared
// emails.ts (Verify email address, Reset password, …).
//
//   GET  /                every editable email: defaults, variables, the current override (settings.read)
//   PUT  /:key            { subject?, heading?, body?, button?, note? } empty fields use the default; all empty resets (settings.update)
//   POST /:key/preview    { fields } the email as it would be sent, with sample values (settings.read)
//   POST /:key/test       { fields } sends that preview to you (settings.update)
//
// Stored in the setting emails.overrides; this process uses a save at once,
// others within 30 seconds (platform.plugin.ts refreshes the templates).
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { EDITABLE_EMAILS, EMAIL_FIELD_LIMITS, emailFieldProblems, emailFields, isEditableEmail, type EditableEmailKey, type EmailFields, type EmailOverrides } from "@vhyxvoid/shared";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { buildEmailService } from "@/modules/notification/infrastructure/email/ResendEmailService";
import { renderEditableEmail, setEmailOverrides } from "@/modules/notification/infrastructure/email/templates";
import type { IEmailService } from "@/modules/notification/domain/services/IEmailService.notification";
import { audit } from "../shared/http";

let mailer: IEmailService | null = null;
const email = () => (mailer ??= buildEmailService());
/** Tests replace the email service. */
export function setEmailsMailer(m: IEmailService | null) {
  mailer = m;
}

const fieldsSchema = z.object(Object.fromEntries(Object.entries(EMAIL_FIELD_LIMITS).map(([k, max]) => [k, z.string().max(max).optional()])) as Record<keyof EmailFields, z.ZodOptional<z.ZodString>>);

function keyOf(raw: string): EditableEmailKey {
  if (!isEditableEmail(raw)) throw new NotFoundError("No such email");
  return raw;
}

/** Only the fields with words in them; nothing when all are empty. */
function cleaned(key: EditableEmailKey, fields: Partial<EmailFields>): Partial<EmailFields> {
  const out = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()])) as Partial<EmailFields>;
  const problems = emailFieldProblems(key, out);
  if (problems.length) throw new ValidationError(problems.join("; "));
  return out;
}

export async function adminEmailRoutes(fastify: FastifyInstance) {
  const current = async () => ((await fastify.platformSettings.get("emails.overrides")) ?? {}) as EmailOverrides;
  /** The preview of `fields` (or the saved wording) with the email's sample values. */
  const preview = (key: EditableEmailKey, fields: Partial<EmailFields>) => renderEditableEmail(key, EDITABLE_EMAILS[key].variables, emailFields(key, { [key]: fields }));

  fastify.get("/", { onRequest: [fastify.requireAbility("settings.read")] }, async (_request, reply) => {
    const saved = await current();
    return successResponse(
      reply,
      "Success",
      200,
      (Object.keys(EDITABLE_EMAILS) as EditableEmailKey[]).map((key) => ({ key, ...EDITABLE_EMAILS[key], override: saved[key] ?? {}, edited: Object.keys(saved[key] ?? {}).length > 0 })),
    );
  });

  fastify.put<{ Params: { key: string } }>("/:key", { onRequest: [fastify.requireAbility("settings.update")] }, async (request, reply) => {
    const key = keyOf(request.params.key);
    const fields = cleaned(key, fieldsSchema.parse(request.body ?? {}));
    const before = await current();
    const next: EmailOverrides = { ...before };
    if (Object.keys(fields).length) next[key] = fields;
    else delete next[key];
    const admin = getAdminContext(request);
    await fastify.platformSettings.update({ "emails.overrides": Object.keys(next).length ? next : null }, admin.id);
    setEmailOverrides(next);
    await audit(fastify, request, { action: Object.keys(fields).length ? "emails.updated" : "emails.reset", targetType: "Email", targetId: key, before: before[key] ?? null, after: next[key] ?? null });
    return successResponse(reply, Object.keys(fields).length ? "Saved" : "Back to the built-in wording", 200, { key, override: next[key] ?? {} });
  });

  fastify.post<{ Params: { key: string } }>("/:key/preview", { onRequest: [fastify.requireAbility("settings.read")] }, async (request, reply) => {
    const key = keyOf(request.params.key);
    const fields = cleaned(key, fieldsSchema.parse((request.body as { fields?: unknown })?.fields ?? {}));
    return successResponse(reply, "Success", 200, preview(key, fields));
  });

  fastify.post<{ Params: { key: string } }>("/:key/test", { onRequest: [fastify.requireAbility("settings.update")], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const key = keyOf(request.params.key);
    const fields = cleaned(key, fieldsSchema.parse((request.body as { fields?: unknown })?.fields ?? {}));
    const admin = getAdminContext(request);
    const msg = preview(key, fields);
    await email().send({ to: admin.email, ...msg, subject: `[Test] ${msg.subject}` });
    return successResponse(reply, "Test sent", 200, { to: admin.email });
  });
}
