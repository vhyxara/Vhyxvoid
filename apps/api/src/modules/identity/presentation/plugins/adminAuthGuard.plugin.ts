import fp from "fastify-plugin";
import { extractToken } from "../../domain/services/TokenExtractor";
import { TokenExpiredError } from "jsonwebtoken";
import {
  InternalServerError,
  UnauthorizedError,
} from "@/core/errors/error.format";

/**
 * Authenticates an admin request: verifies the JWT, requires an admin-type
 * token, then checks the admin's CURRENT state through AuthStateCache (one
 * Redis GET; Postgres on a miss). A disabled or deleted admin is rejected, and
 * request.admin.isSuperAdmin is the real value, not the claim signed into the
 * token: requireAbility and requireSuperAdmin trust request.admin, so a
 * demotion takes effect within the cache TTL instead of when the token expires.
 * See api/decision.md, 2026-09-24, "H2".
 *
 * Every authentication failure is a 401 (it used to be 403): apps/admin
 * refreshes its token on a 401 only, so an expired token must say 401 or the
 * admin is stuck until they log in again. 403 stays for "authenticated, but
 * lacks the ability" (requireAbility / requireSuperAdmin).
 */
export default fp(async function adminAuthGuardPlugin(fastify) {
  fastify.decorate("adminAuthGuard", async (request, reply) => {
    const token = extractToken(request);
    if (!token) {
      throw new UnauthorizedError("Unauthorized: Missing token");
    }

    const jwtService = fastify.jwtService;
    if (!jwtService) {
      throw new InternalServerError(
        "Server misconfiguration: JWT service not registered",
      );
    }

    let payload;
    try {
      payload = jwtService.verify(token);
    } catch (err: any) {
      if (err instanceof TokenExpiredError) {
        throw new UnauthorizedError("Unauthorized: Token expired");
      }
      throw new UnauthorizedError("Unauthorized: Invalid token");
    }

    if (payload.type !== "admin" || !payload.sub) {
      throw new UnauthorizedError("Not an admin token");
    }

    const state = await fastify.authStateCache.getAdmin(payload.sub);
    if (!state || !state.active) {
      throw new UnauthorizedError("Unauthorized: Admin account is not active");
    }
    // Tokens signed before tokenVersion existed carry none: treat as 0.
    if ((payload.tokenVersion ?? 0) !== (state.tokenVersion ?? 0)) {
      throw new UnauthorizedError("Unauthorized: Session has ended");
    }

    request.admin = {
      id: payload.sub,
      email: payload.email,
      isSuperAdmin: state.isSuperAdmin,
    };
  });
});
