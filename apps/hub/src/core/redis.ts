import Redis from "ioredis";
let client: Redis | null = null;

export async function initRedis(url: string) {
  if (client) return client;
  client = new Redis(url);
  client.on("connect", () => console.log("[hub] redis connected"));
  client.on("error", (e) => console.error("[hub] redis error", e));
  // wait ready
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis_timeout")), 5000);
    client!.once("ready", () => {
      clearTimeout(t);
      resolve();
    });
    client!.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  return client;
}

export function getRedis() {
  if (!client) throw new Error("redis not initialized");
  return client;
}
