// import Redis from "ioredis";

// export const redis = new Redis({
//   host: process.env.UPSTASH_REDIS_REST_URL,
// //   port: 6379
// });

import { Redis } from "@upstash/redis";
let client: Redis | null = null;

export function initRedis() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing",
    );
  }

  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "redis://localhost:6379",
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  console.log(
    "✅ Connected to Upstash Redis",
    client ? "Client initialized" : "Client not initialized",
  );
  return client;
}
export function getRedis() {
  try {
    if (!client) throw new Error("redis not initialized");
  } catch (error) {
    console.log("🚀 ~ file: RedisClient.ts:60 ~ getRedis ~ error", error);
  }
  return client;
}
