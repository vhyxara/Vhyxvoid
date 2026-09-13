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
  /** Disable tunnel in production. Default: auto (disabled when NODE_ENV=production) */
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
  const enabled = userConfig.enabled ?? process.env.NODE_ENV !== "production";

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
