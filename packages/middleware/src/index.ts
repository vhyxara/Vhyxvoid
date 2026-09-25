import type { Request, Response, NextFunction } from "express";
import { resolveConfig, VhyxvoidConfig } from "./config";
import { adoptListeningPort, startTunnel } from "./tunnel";

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

  // Passthrough; the tunnel runs in the background. The first request tells
  // us which port the app really listens on (Express has no other way).
  let portChecked = !config.enabled || config.portExplicit;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!portChecked) {
      portChecked = true;
      adoptListeningPort(req.socket?.localPort, config.portExplicit);
    }
    next();
  };
}
