// import Redis from "ioredis";
import {Redis} from "@upstash/redis"
let client: Redis | null = null;

// export async function initRedis(url: string) {
//   if (client) return client;
//   client = new Redis(url);
//   client.on("connect", () => console.log("[hub] redis connected"));
//   client.on("error", (e) => console.error("[hub] redis error", e));
//   // wait ready
//   await new Promise<void>((resolve, reject) => {
//     const t = setTimeout(() => reject(new Error("redis_timeout")), 5000);
//     client!.once("ready", () => {
//       clearTimeout(t);
//       resolve();
//     });
//     client!.once("error", (e) => {
//       clearTimeout(t);
//       reject(e);
//     });
//   });
//   return client;
// }



export function initRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing')
  }

  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "redis://localhost:6379",
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })

  console.log('✅ Connected to Upstash Redis')
  return client
}
export function getRedis() {
  if (!client) throw new Error("redis not initialized");
  return client;
}
