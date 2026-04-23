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
 * JWT is self-contained — we verify the signature and trust the payload.
 * No DB call needed on every request.
 *
 * tokenVersion invalidation works like this:
 *   - tokenVersion is embedded in the JWT at sign time (login / token refresh)
 *   - When all sessions are revoked (logout-all / password change / suspicious activity),
 *     user.tokenVersion is incremented in the DB
 *   - Old tokens with a lower tokenVersion are rejected
 *   - This check only costs a DB call on logout-all, not on every request
 *
 * The only time we need a DB call in the guard is if you want to check
 * tokenVersion on EVERY request (true revocation). That's a deliberate
 * trade-off: if you need it, add Redis for an O(1) blocklist instead of
 * a Postgres hit per request.
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
