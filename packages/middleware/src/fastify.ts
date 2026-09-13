import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { resolveConfig, VhyxvoidConfig } from "./config";
import { startTunnel, stopTunnel } from "./tunnel";

/**
 * Fastify plugin.
 *
 * @example
 * import { vhyxvoidPlugin } from '@vhyxvoid/middleware/fastify'
 * await app.register(vhyxvoidPlugin)
 */
const plugin: FastifyPluginAsync<VhyxvoidConfig> = async (fastify, opts) => {
  const config = resolveConfig(opts);

  if (config.enabled) {
    startTunnel(config);
  }

  fastify.addHook("onClose", async () => {
    stopTunnel();
  });
};

export const vhyxvoidPlugin = fp(plugin, {
  name: "vhyxvoid",
  fastify: ">=4.0.0",
});
