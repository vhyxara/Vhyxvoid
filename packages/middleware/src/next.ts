import { resolveConfig, VhyxvoidConfig } from "./config";
import { startTunnel } from "./tunnel";

/**
 * Wraps Next.js config to start the tunnel when the dev server starts.
 *
 * @example
 * // next.config.ts
 * import { withVhyxvoid } from '@vhyxvoid/middleware/next'
 * export default withVhyxvoid({
 *   // your existing next config
 * })
 *
 * // with options:
 * export default withVhyxvoid(nextConfig, { port: 3010, label: 'app' })
 */
export function withVhyxvoid(
  nextConfig: Record<string, unknown> = {},
  userConfig: VhyxvoidConfig = {},
) {
  const config = resolveConfig(userConfig);

  if (config.enabled) {
    // next.config runs once when dev server starts — safe to start tunnel here
    startTunnel(config);
  }

  return nextConfig;
}
