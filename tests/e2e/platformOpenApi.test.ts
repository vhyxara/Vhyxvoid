// The platform API's OpenAPI document (apps/api platform/shared/platformOpenApi.ts):
// built from the real route modules, so it lists exactly the routes that take
// API keys; every one has a summary; it passes our own OpenAPI validator; the
// copy in the docs is current; the API serves it without a key.
//
// Refresh the docs copy after changing a route:
//   UPDATE_PLATFORM_OPENAPI=1 npx vitest run --config tests/vitest.config.ts tests/e2e/platformOpenApi.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as fs from "fs";
import * as path from "path";

import { validateSpec } from "../../packages/shared/src";
import { buildPlatformOpenApi, platformRouteCollector } from "../../apps/api/src/modules/platform/shared/platformOpenApi";
import { platformApiRoutes } from "../../apps/api/src/modules/platform/shared/platformApi.routes";
import { mockRoutes } from "../../apps/api/src/modules/platform/mocks/mocks.routes";
import { apiClientRoutes } from "../../apps/api/src/modules/platform/apiclient/apiClient.routes";
import { analyticsRoutes } from "../../apps/api/src/modules/platform/perf/analytics.routes";
import { specRoutes } from "../../apps/api/src/modules/platform/specs/specs.routes";
import { teamChatRoutes } from "../../apps/api/src/modules/platform/team/chat.routes";
import { teamDocRoutes } from "../../apps/api/src/modules/platform/team/docs.routes";
import { teamIssueRoutes } from "../../apps/api/src/modules/platform/team/issues.routes";
import { teamCommentRoutes } from "../../apps/api/src/modules/platform/team/comments.routes";
import { aiRoutes } from "../../apps/api/src/modules/platform/ai/ai.routes";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const COPY = path.resolve(__dirname, "../../apps/docs/public/platform-api.openapi.json");
const VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../apps/api/package.json"), "utf8")).version as string;

describe("the platform API's OpenAPI document", () => {
  let f: any;
  const collector = platformRouteCollector();

  beforeAll(async () => {
    f = Fastify();
    // Registration only: nothing below is called.
    f.decorate("prisma", {});
    f.decorate("redis", {});
    f.decorate("platformSettings", { get: async () => true });
    f.decorate("userAuthGuard", async () => undefined);
    f.addHook("onRoute", collector.onRoute);
    const hub = {} as never;
    await f.register(mockRoutes, { prefix: "/api/v1/mocks", hub });
    await f.register(apiClientRoutes, { prefix: "/api/v1/api-client" });
    await f.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
    await f.register(specRoutes, { prefix: "/api/v1/specs", hub, dns: {} as never });
    await f.register(teamChatRoutes, { prefix: "/api/v1/team" });
    await f.register(platformApiRoutes, { prefix: "/api/v1/platform", openApiRoutes: collector.routes });
    await f.register(aiRoutes, { prefix: "/api/v1/ai", model: null });
    await f.register(teamDocRoutes, { prefix: "/api/v1/team" });
    await f.register(teamIssueRoutes, { prefix: "/api/v1/team" });
    await f.register(teamCommentRoutes, { prefix: "/api/v1/team" });
    await f.ready();
  });
  afterAll(() => f?.close());

  const build = () => buildPlatformOpenApi(collector.routes, { serverUrl: "https://api.vhyxvoid.com", version: VERSION });

  it("lists every route that takes an API key, each with a summary", () => {
    expect(collector.routes.length).toBeGreaterThanOrEqual(50);
    const missing = collector.routes.filter((r) => !r.doc?.summary).map((r) => `${r.method} ${r.url}`);
    expect(missing).toEqual([]);
    const doc = build() as any;
    const ops = Object.values(doc.paths).flatMap((p: any) => Object.values(p)) as any[];
    expect(ops).toHaveLength(collector.routes.length);
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
    // Scopes and request bodies come through.
    const run = doc.paths["/api/v1/api-client/{accountId}/collections/{id}/run"].post;
    expect(run).toMatchObject({ "x-required-scope": "tests:run", tags: ["API client"] });
    expect(run.responses["202"]).toBeDefined();
    expect(run.requestBody.content["application/json"].schema.properties.environmentId).toBeDefined();
    const issues = doc.paths["/api/v1/team/{accountId}/issues"].get;
    expect(issues.parameters.map((p: any) => `${p.in}:${p.name}`)).toEqual(["path:accountId", "query:q", "query:sort"]);
    expect(doc.paths["/api/v1/platform/whoami"].get["x-required-scope"]).toBeNull();
    // Dashboard-only routes are not in it.
    expect(doc.paths["/api/v1/specs/{accountId}/{id}/sharing"]).toBeUndefined();
  });

  it("passes the platform's own OpenAPI validator", () => {
    const errors = validateSpec(build()).filter((p) => p.severity === "error");
    expect(errors).toEqual([]);
  });

  it("the copy in the docs is current", () => {
    const text = `${JSON.stringify(build(), null, 2)}\n`;
    if (process.env.UPDATE_PLATFORM_OPENAPI === "1") fs.writeFileSync(COPY, text);
    expect(fs.existsSync(COPY), "missing: run with UPDATE_PLATFORM_OPENAPI=1").toBe(true);
    expect(fs.readFileSync(COPY, "utf8"), "outdated: run with UPDATE_PLATFORM_OPENAPI=1").toBe(text);
  });

  it("is served without a key", async () => {
    const r = await f.inject({ method: "GET", url: "/api/v1/platform/openapi.json" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/json/);
    expect(r.json()).toMatchObject({ openapi: "3.1.0", info: { title: "VhyxVoid platform API" } });
    // Paths carry /api/v1, so the server is the bare origin (a base URL plus a path must not repeat it).
    expect(r.json().servers[0].url).toMatch(/^https:\/\/api\.[^/]+$/);
    expect(Object.keys(r.json().paths)).toEqual(Object.keys(build().paths));
  });
});
