import type { FastifyInstance } from "fastify";
import { ForbiddenError } from "@/core/errors/error.format";
import { prismaOf } from "../shared/http";

/** Whether an email's domain matches a list entry (exact domain or a subdomain of it). */
export function domainMatches(email: string, domains: string[]): boolean {
  const domain = email.split("@").pop()?.toLowerCase() ?? "";
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Admin-controlled sign-up rules (settings: auth.*). An invited address may
 * always register, so closed sign-ups still let teams grow.
 */
export async function assertSignupAllowed(fastify: FastifyInstance, email: string): Promise<void> {
  const settings = fastify.platformSettings;
  const [enabled, allowed, blocked] = await Promise.all([
    settings.get("auth.signupsEnabled"),
    settings.get("auth.allowedEmailDomains"),
    settings.get("auth.blockedEmailDomains"),
  ]);
  const normalized = email.trim().toLowerCase();
  if (blocked.length && domainMatches(normalized, blocked)) {
    throw new ForbiddenError("Sign-ups from this email domain are not allowed");
  }
  const invited = async () =>
    (await prismaOf(fastify).accountInvitation.count({ where: { email: { equals: normalized, mode: "insensitive" }, status: "PENDING", expiresAt: { gt: new Date() } } })) > 0;
  if (allowed.length && !domainMatches(normalized, allowed) && !(await invited())) {
    throw new ForbiddenError("Sign-ups are limited to approved email domains");
  }
  if (!enabled && !(await invited())) {
    throw new ForbiddenError("Sign-ups are currently closed. Ask a team owner for an invitation.");
  }
}
