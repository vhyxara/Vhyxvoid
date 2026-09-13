import type { Request, Response, NextFunction } from "express";
import { resolveConfig, VhyxvoidConfig } from "./config";
import { startTunnel } from "./tunnel";

export type { VhyxvoidConfig };
export { stopTunnel } from "./tunnel";

/**
 * Express middleware. Call once before your routes.
 *
 * @example
 * import { vhyxvoid } from '@vhyxvoid/middleware'
 * app.use(vhyxvoid())
 *
 * // or with explicit config:
 * app.use(vhyxvoid({ port: 3000, label: 'api' }))
 */
export function vhyxvoid(userConfig: VhyxvoidConfig = {}) {
  const config = resolveConfig(userConfig);

  if (config.enabled) {
    startTunnel(config);
  }

  // Middleware is a no-op passthrough — tunnel runs in background
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
