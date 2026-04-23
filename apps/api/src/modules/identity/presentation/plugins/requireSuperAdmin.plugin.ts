import { ForbiddenError } from "@/core/errors/error.format";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

export default fp(async function requireSuperAdminPlugin(
  fastify: FastifyInstance,
) {
  fastify.decorate(
    "requireSuperAdmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await fastify.adminAuthGuard(request, reply);

      if (!request.admin?.isSuperAdmin) {
        // return reply.code(403).send({
        //   error: 'Forbidden: Only super admin can perform action',
        // });
        throw new ForbiddenError(
          "Forbidden: Only super admin can perform action",
        );
      }
    },
  );
});
