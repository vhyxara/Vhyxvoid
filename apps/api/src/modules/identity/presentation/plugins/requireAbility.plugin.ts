import { ForbiddenError } from "@/core/errors/error.format";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { th } from "zod/v4/locales";

export default fp(async function requireAbilityPlugin(
  fastify: FastifyInstance,
) {
  fastify.decorate("requireAbility", (ability: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await fastify.adminAuthGuard(request, reply);

      if (!request.admin) {
        // reply.code(401).send({ error: 'Not authenticated' });
        // return;
        throw new ForbiddenError("Not authenticated");
      }

      if (request.admin.isSuperAdmin) {
        return;
      }

      const hasAbility = await fastify.verifyAdminAbilityUseCase.execute(
        request.admin.id,
        ability,
      );

      if (!hasAbility) {
        // return reply.code(403).send({
        //   error: `Forbidden: Missing ability '${ability}'`,
        // });
        throw new ForbiddenError(`Forbidden: Missing ability '${ability}'`);
      }
    };
  });
});
