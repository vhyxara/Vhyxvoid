// Team activity for the platform features (alerts, inbox settings, inspector,
// traffic rules). One table maps each successful mutating route to an
// AuditLog row, written by an onResponse hook, so handlers stay unchanged and
// a new route is one line here. Routes that write their own rows are NOT
// listed (tunnel access "tunnel.access.*", custom domains "custom_domain.*",
// inbox redeliver/purge "tunnel.inbox.*"), and neither are the identity/key
// use cases: one change, one row.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@/generated/prisma";

type Params = Record<string, string | undefined>;
type Body = Record<string, unknown> | undefined;

interface ActivityRoute {
  action: string;
  resourceType: string;
  /** Extra, non-secret details for the feed. Never copy passwords or tokens. */
  meta?: (p: Params, b: Body) => Record<string, unknown>;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** "METHOD /full/route/url" -> what to record. */
export const ACTIVITY_ROUTES: Record<string, ActivityRoute> = {
  "POST /api/v1/alerts/:accountId": { action: "ALERT_RULE_CREATED", resourceType: "AlertRule", meta: (_p, b) => ({ name: str(b?.name, 80), type: str(b?.type, 40) }) },
  "PATCH /api/v1/alerts/:accountId/:id": { action: "ALERT_RULE_UPDATED", resourceType: "AlertRule", meta: (p, b) => ({ id: p.id, name: str(b?.name, 80), enabled: typeof b?.enabled === "boolean" ? b.enabled : undefined }) },
  "DELETE /api/v1/alerts/:accountId/:id": { action: "ALERT_RULE_DELETED", resourceType: "AlertRule", meta: (p) => ({ id: p.id }) },
  "PUT /api/v1/traffic-rules/:accountId/:label": {
    action: "TRAFFIC_RULES_UPDATED",
    resourceType: "Tunnel",
    meta: (p, b) => ({ label: p.label, count: Array.isArray(b?.rules) ? b!.rules.length : undefined }),
  },
  "DELETE /api/v1/traffic-rules/:accountId/:label": { action: "TRAFFIC_RULES_UPDATED", resourceType: "Tunnel", meta: (p) => ({ label: p.label, count: 0 }) },
  "POST /api/v1/mocks/:accountId": { action: "MOCK_API_CREATED", resourceType: "MockApi", meta: (_p, b) => ({ label: str(b?.label, 63), name: str(b?.name, 80), template: str(b?.template, 40), fromOpenApi: b?.openapi !== undefined || undefined }) },
  "PUT /api/v1/mocks/:accountId/:id": {
    action: "MOCK_API_UPDATED",
    resourceType: "MockApi",
    meta: (p, b) => ({ id: p.id, label: str(b?.label, 63), name: str(b?.name, 80), endpoints: Array.isArray(b?.endpoints) ? b!.endpoints.length : undefined, enabled: typeof b?.enabled === "boolean" ? b.enabled : undefined }),
  },
  "DELETE /api/v1/mocks/:accountId/:id": { action: "MOCK_API_DELETED", resourceType: "MockApi", meta: (p) => ({ id: p.id }) },
  "POST /api/v1/mocks/:accountId/:id/record": { action: "MOCK_API_RECORDED", resourceType: "MockApi", meta: (p, b) => ({ id: p.id, label: str(b?.label, 63), count: Array.isArray(b?.ids) ? b!.ids.length : undefined }) },
  "DELETE /api/v1/mocks/:accountId/:id/data/:rid": { action: "MOCK_API_DATA_RESET", resourceType: "MockApi", meta: (p) => ({ id: p.id, resource: p.rid }) },
  "POST /api/v1/api-client/:accountId/collections": { action: "API_COLLECTION_CREATED", resourceType: "ApiCollection", meta: (_p, b) => ({ name: str(b?.name, 80), imported: b?.document !== undefined || undefined, fromMock: str(b?.mockId, 40) }) },
  "PUT /api/v1/api-client/:accountId/collections/:id": { action: "API_COLLECTION_UPDATED", resourceType: "ApiCollection", meta: (p, b) => ({ id: p.id, name: str(b?.name, 80), requests: Array.isArray(b?.requests) ? b!.requests.length : undefined }) },
  "DELETE /api/v1/api-client/:accountId/collections/:id": { action: "API_COLLECTION_DELETED", resourceType: "ApiCollection", meta: (p) => ({ id: p.id }) },
  "POST /api/v1/api-client/:accountId/collections/:id/run": { action: "API_COLLECTION_RUN", resourceType: "ApiCollection", meta: (p, b) => ({ id: p.id, folderId: str(b?.folderId, 64) }) },
  "POST /api/v1/api-client/:accountId/environments": { action: "API_ENVIRONMENT_CREATED", resourceType: "ApiEnvironment", meta: (_p, b) => ({ name: str(b?.name, 80) }) },
  "PUT /api/v1/api-client/:accountId/environments/:id": { action: "API_ENVIRONMENT_UPDATED", resourceType: "ApiEnvironment", meta: (p, b) => ({ id: p.id, name: str(b?.name, 80) }) },
  "DELETE /api/v1/api-client/:accountId/environments/:id": { action: "API_ENVIRONMENT_DELETED", resourceType: "ApiEnvironment", meta: (p) => ({ id: p.id }) },
  "POST /api/v1/mocks/:accountId/:id/import": { action: "MOCK_API_IMPORTED", resourceType: "MockApi", meta: (p, b) => ({ id: p.id, replace: b?.replace === true || undefined }) },
  "PUT /api/v1/inbox/:accountId/:label": { action: "INBOX_SETTINGS_UPDATED", resourceType: "Tunnel", meta: (p, b) => ({ label: p.label, enabled: typeof b?.enabled === "boolean" ? b.enabled : undefined }) },
  "POST /api/v1/inspector/:accountId/:label/:id/replay": { action: "REQUEST_REPLAYED", resourceType: "Tunnel", meta: (p) => ({ label: p.label }) },
  "PUT /api/v1/inspector/:accountId/settings": { action: "INSPECTOR_CAPTURE_CHANGED", resourceType: "Account", meta: (_p, b) => ({ capture: typeof b?.capture === "boolean" ? b.capture : undefined }) },
  "DELETE /api/v1/inspector/:accountId/:label": { action: "INSPECTOR_CLEARED", resourceType: "Tunnel", meta: (p) => ({ label: p.label }) },
};

function clean(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Registers the hook on a plugin scope. Fail-soft: a lost row is logged, never an error for the user. */
export function recordActivity(fastify: FastifyInstance, prisma: PrismaClient): void {
  fastify.addHook("onResponse", async (request: FastifyRequest, reply) => {
    if (reply.statusCode >= 300) return;
    const route = ACTIVITY_ROUTES[`${request.method} ${request.routeOptions?.url ?? ""}`];
    if (!route) return;
    const params = (request.params ?? {}) as Params;
    const accountId = params.accountId;
    const userId = (request as unknown as { user?: { userId?: string } }).user?.userId;
    if (!accountId || !userId) return;
    try {
      await prisma.auditLog.create({
        data: {
          accountId,
          userId,
          action: route.action,
          resourceType: route.resourceType,
          resourceId: params.id ?? params.label ?? null,
          metadata: clean(route.meta?.(params, request.body as Body) ?? {}) as object,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
        },
      });
    } catch (err) {
      console.error("[activity] not recorded", route.action, (err as Error).message);
    }
  });
}
