// identity/infrastructure/plugins/userAuthGuard.ts

import fp from "fastify-plugin";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError } from "@/core/errors/error.format";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { JwtPayload } from "@/core/types/core/jwt";
// import { UnauthorizedError } from '../../domain/errors';

/**
 * userAuthGuard
 *
 * Verifies the Bearer JWT on protected user routes.
 * Populates request.user = { id, email } on success.
 *
 * Mirrors adminAuthGuard — same structure, same error codes.
 *
 * Usage in routes:
 *   { onRequest: [fastify.userAuthGuard] }
 */
// export default fp(async (fastify: FastifyInstance) => {
//   const container = fastify.container;

//   const jwtService = container.resolve(RS256JwtService);

//   const guard = async (request: FastifyRequest, reply: FastifyReply) => {
//     const authHeader = request.headers.authorization;

//     if (!authHeader) {
//       throw new UnauthorizedError("Missing authorization header");
//     }

//     const parts = authHeader.split(" ");

//     if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
//       throw new UnauthorizedError(
//         "Invalid authorization format. Use: Bearer <token>",
//       );
//     }

//     const token = parts[1];

//     if (!token?.trim()) {
//       throw new UnauthorizedError("Missing token in authorization header");
//     }

//     let payload: JwtPayload;

//     try {
//       payload = jwtService.verify(token);
//     } catch {
//       throw new UnauthorizedError("Invalid or expired access token");
//     }

//     if (!payload?.sub || !payload?.email) {
//       throw new UnauthorizedError("Malformed token payload");
//     }

//     // const user = await uow.userRepository.findById(payload.sub);
//     // if (!user) {
//     //   throw new UnauthorizedError('User not found');
//     // }

//     // if (user.tokenVersion !== payload.tokenVersion) {
//     //   throw new UnauthorizedError('Token has been invalidated. Please log in again.');
//     // }

//     // user.ensureCanLogin(new Date());
//     const jwtUser: JwtPayload = {
//       sub: payload.sub,
//       userId: payload.sub,
//       email: payload.email,
//       roles: payload.roles ?? [],
//       abilities: payload.abilities ?? [],
//       tokenVersion: payload.tokenVersion,
//     };
//     request.user = jwtUser;
//   };

//   fastify.decorate("userAuthGuard", guard);
// });

/**
 * The JWT's signature and expiry are verified, then the token is checked
 * against the user's CURRENT auth state (AuthStateCache: one Redis GET per
 * request, Postgres on a miss): its tokenVersion must still be the user's,
 * and the user must still be active. Logout, logout-all and password
 * reset/change bump tokenVersion, so they revoke outstanding access tokens
 * at once instead of when they expire. Admin tokens are rejected: each
 * guard accepts only its own token type. See api/decision.md, 2026-09-24, "H2".
 */
export default fp(async (fastify: FastifyInstance) => {
  const container = fastify.container;
  const jwtService = container.resolve(RS256JwtService);

  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError("Missing authorization header");
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      throw new UnauthorizedError(
        "Invalid authorization format. Use: Bearer <token>",
      );
    }

    const token = parts[1];

    if (!token?.trim()) {
      throw new UnauthorizedError("Missing token in authorization header");
    }

    let payload: JwtPayload;

    try {
      payload = jwtService.verify(token);
    } catch {
      // Covers: expired, invalid signature, malformed
      throw new UnauthorizedError("Invalid or expired access token");
    }

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedError("Malformed token payload");
    }

    // Only user access tokens (an admin token used to pass as sub=<adminId>).
    // Tokens issued before this check carried no type and need one refresh.
    if (payload.type !== "user") {
      throw new UnauthorizedError("Not a user access token");
    }

    const state = await fastify.authStateCache.getUser(payload.sub);
    if (!state || !state.active || state.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedError("Access token has been revoked");
    }

    // Attach verified identity to request — no DB call
    request.user = {
      sub: payload.sub,
      userId: payload.sub,
      email: payload.email,
      tokenVersion: payload.tokenVersion,
      roles: payload.roles ?? [],
      abilities: payload.abilities ?? [],
    };
  };

  fastify.decorate("userAuthGuard", guard);
});
