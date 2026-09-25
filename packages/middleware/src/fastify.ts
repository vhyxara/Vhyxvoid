import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { resolveConfig, VhyxvoidConfig } from "./config";
import { adoptListeningPort, startTunnel, stopTunnel } from "./tunnel";

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

  if (config.enabled && !config.portExplicit) {
    // Once listening, the server knows its real port.
    const adopt = () => {
      const addr = fastify.server.address();
      if (addr && typeof addr === "object") {
        adoptListeningPort(addr.port, config.portExplicit);
      }
    };
    try {
      fastify.addHook("onListen" as any, async () => adopt());
    } catch {
      // Fastify before onListen existed: fall back to the first request.
      let checked = false;
      fastify.addHook("onRequest", async (req) => {
        if (checked) return;
        checked = true;
        adoptListeningPort(req.raw.socket?.localPort, config.portExplicit);
      });
    }
  }

  fastify.addHook("onClose", async () => {
    stopTunnel();
  });
};

export const vhyxvoidPlugin = fp(plugin, {
  name: "vhyxvoid",
  fastify: ">=4.0.0",
});
