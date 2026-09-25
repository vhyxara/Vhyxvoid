export interface VhyxvoidConfig {
  key?: string;
  secret?: string;
  port?: number;
  label?: string;
  hub?: string;
  /** Write tunnel URL to this env file on connect. e.g. ".env.local" */
  writeEnv?: string;
  /** Env var name to write tunnel URL into. Default: NEXT_PUBLIC_TUNNEL_URL */
  envKey?: string;
  /** Called when tunnel is active with the public URL */
  onConnect?: (tunnelUrl: string) => void;
  /**
   * Force the tunnel on (`true`) or off (`false`). Default: on only when
   * NODE_ENV is "development" and not on CI (CI set to anything but "false"
   * or "0"), the same rule as @vhyxvoid/next plus the CI check. In 1.0.5
   * and earlier the default was "on unless NODE_ENV is production".
   */
  enabled?: boolean;
}

export function resolveConfig(userConfig: VhyxvoidConfig = {}): {
  key: string;
  secret: string;
  port: number;
  label: string;
  hub: string;
  writeEnv?: string;
  envKey: string;
  onConnect?: (url: string) => void;
  enabled: boolean;
} {
  const key = userConfig.key ?? process.env.VHYXVOID_API_KEY ?? "";
  const secret = userConfig.secret ?? process.env.VHYXVOID_SECRET ?? "";
  const port =
    userConfig.port ?? parseInt(process.env.VHYXVOID_PORT ?? "3000", 10);
  const label = userConfig.label ?? process.env.VHYXVOID_LABEL ?? "default";
  const hub =
    userConfig.hub ??
    process.env.VHYXVOID_HUB_URL ??
    "wss://hub.vhyxvoid.com/agent";
  const envKey =
    userConfig.envKey ??
    process.env.VHYXVOID_ENV_KEY ??
    "NEXT_PUBLIC_TUNNEL_URL";
  const writeEnv = userConfig.writeEnv ?? process.env.VHYXVOID_WRITE_ENV;

  // Auto-disable in production unless explicitly enabled
  // Opt-in outside development: a staging box, CI runner or container with
  // NODE_ENV unset/"test"/"staging" and the key in its environment used to
  // open a public tunnel silently (audit part2 G7).
  const enabled =
    userConfig.enabled ?? (process.env.NODE_ENV === "development" && !isCI());

  return {
    key,
    secret,
    port,
    label,
    hub,
    writeEnv,
    envKey,
    onConnect: userConfig.onConnect,
    enabled,
  };
}

/** CI providers set CI (GitHub Actions, GitLab, CircleCI, Travis, ...). */
function isCI(): boolean {
  const ci = process.env.CI;
  return ci !== undefined && ci !== "" && ci !== "false" && ci !== "0";
}
