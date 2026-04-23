import fp from "fastify-plugin";
import { extractToken } from "../../domain/services/TokenExtractor";
import { TokenExpiredError } from "jsonwebtoken";
import {
  ForbiddenError,
  InternalServerError,
} from "@/core/errors/error.format";

export default fp(async function adminAuthGuardPlugin(fastify) {
  fastify.decorate("adminAuthGuard", async (request, reply) => {
    try {
      const token = extractToken(request);

      if (!token) {
        // return reply.code(401).send({ error: 'Unauthorized: Missing token' });
        throw new ForbiddenError("Unauthorized: Missing token");
      }

      const jwtService = fastify.jwtService;

      if (!jwtService) {
        // reply.code(500).send({ error: 'Server misconfiguration: JWT service not registered' });
        throw new InternalServerError(
          "Server misconfiguration: JWT service not registered",
        );
      }

      let payload;

      try {
        payload = jwtService.verify(token);
      } catch (err: any) {
        if (err instanceof TokenExpiredError) {
          // return reply.code(401).send({
          //   error: 'Unauthorized: Token expired',
          //   expiredAt: err.expiredAt,
          // });
          throw new ForbiddenError("Unauthorized: Token expired");
        }
        // return reply.code(401).send({ error: 'Unauthorized: Invalid token' });
        throw new ForbiddenError("Unauthorized: Invalid token");
      }

      if (payload.type !== "admin") {
        // return reply.code(401).send({ error: 'Not an admin token' });
        throw new ForbiddenError("Not an admin token");
      }

      request.admin = {
        id: payload.sub,
        email: payload.email,
        isSuperAdmin: payload.isSuperAdmin,
      };
    } catch (error) {
      console.error("AdminAuthGuard error", error);

      // reply.code(401).send({ error: 'Unauthorized: Could not authenticate admin' });
      throw new ForbiddenError("Unauthorized: Could not authenticate admin");
    }
  });
});
