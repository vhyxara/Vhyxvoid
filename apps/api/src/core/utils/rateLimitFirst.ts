import type { FastifyInstance, RouteOptions } from "fastify";
import fastifyRateLimit, { type RateLimitPluginOptions } from "@fastify/rate-limit";

const ownHookCount = Symbol("ownOnRequestHookCount");

type Hooks = RouteOptions["onRequest"];

function asArray(hooks: Hooks): unknown[] {
  if (!hooks) return [];
  return Array.isArray(hooks) ? hooks : [hooks];
}

/**
 * Registers @fastify/rate-limit so its check runs before a route's own
 * onRequest hooks.
 *
 * The plugin attaches to each route through an onRoute hook that appends its
 * handler to the route's `onRequest` array, after hooks such as
 * `fastify.userAuthGuard`. A guard that rejects (401) then ends the request
 * before the limiter counts it, so an unauthenticated flood never gets a 429
 * and every attempt costs a JWT verification.
 *
 * The onRoute hook registered before the plugin records how many onRequest
 * hooks the route declared itself; the one registered after moves whatever
 * the plugin appended to the front. Root onRoute hooks run in the order they
 * were added and apply to routes in every child plugin.
 */
export async function registerRateLimitFirst(
  server: FastifyInstance,
  options: RateLimitPluginOptions,
): Promise<void> {
  server.addHook("onRoute", (route) => {
    (route as any)[ownHookCount] = asArray(route.onRequest).length;
  });

  await server.register(fastifyRateLimit, options);

  server.addHook("onRoute", (route) => {
    const hooks = asArray(route.onRequest);
    const own = (route as any)[ownHookCount] ?? hooks.length;
    if (hooks.length > own) {
      route.onRequest = [...hooks.slice(own), ...hooks.slice(0, own)] as Hooks;
    }
  });
}
