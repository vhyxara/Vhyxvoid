import fp from "fastify-plugin";
import { Container } from "@/core/container/container";
export default fp(async (fastify) => {
  const container = new Container();

  fastify.decorate("container", container);
});
