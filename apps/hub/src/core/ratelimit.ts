// hub/src/ratelimit.ts

import { getRedis } from "./redis";

export async function allowRequest(
  orgId: string,
  capacity = 100,
  refillSeconds = 60
) {
  const redis = getRedis();
  const key = `rate:${orgId}`;
  const now = Date.now();
  // simple token bucket approximation: counter with expiry
  const cur = await redis.incr(key);
  if (cur === 1) {
    await redis.expire(key, refillSeconds);
  }
  return cur <= capacity;
}
