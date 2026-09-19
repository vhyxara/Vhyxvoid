import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
// zod is only resolvable from apps/api's own node_modules under pnpm, and the handler under
// test uses that copy, so this must too (a second copy would fail its instanceof check).
import { ZodError, z } from "../../apps/api/node_modules/zod";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { NotFoundError } from "../../apps/api/src/core/errors/error.format";

// Context.md item 33 (apps/api): `server.ts` used to call setErrorHandler AFTER
// registerPlugins/registerRoutes. Fastify gives each nested plugin the error handler
// that exists when that plugin is registered, so effectively the whole API kept
// Fastify's default handler: every ZodError became an opaque 500 and every AppError
// lost its {success, code, message, data, requestId} shape. Separately, the app builds
// Fastify() with no logger, so the unhandled-exception branch's request.log.error was
// silent and 500s left nothing in the server output.
//
// buildServer() needs Postgres and Redis, so it cannot be booted in a test. The
// ordering is guarded by reading server.ts; the handler's behaviour is tested directly.

function fakeReply() {
  const reply: any = { statusCode: 0, body: undefined };
  reply.status = (code: number) => ((reply.statusCode = code), reply);
  reply.send = (body: unknown) => ((reply.body = body), reply);
  return reply;
}

const request = (over: Record<string, unknown> = {}) =>
  ({ id: "req-1", method: "GET", url: "/x", log: { error: vi.fn() }, ...over }) as any;

afterEach(() => vi.restoreAllMocks());

describe("errorHandler", () => {
  it("turns a ZodError into a 400 with the field errors, not a 500", () => {
    const parsed = z.object({ n: z.number() }).safeParse({ n: "x" });
    const reply = fakeReply();

    errorHandler((parsed as any).error as ZodError, request(), reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toMatchObject({ success: false, code: "VALIDATION_ERROR", requestId: "req-1" });
    expect(reply.body.errors[0].path).toEqual(["n"]);
  });

  it("keeps an AppError's status and response shape", () => {
    const reply = fakeReply();

    errorHandler(new NotFoundError("nope"), request(), reply);

    expect(reply.statusCode).toBe(404);
    expect(reply.body).toMatchObject({ success: false, message: "nope", data: null, requestId: "req-1" });
  });

  it("logs an unhandled exception to the console, so it is visible even with Fastify's logger off", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    const reply = fakeReply();

    errorHandler(boom, request({ method: "POST", url: "/things" }), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.body).toMatchObject({ code: "INTERNAL_ERROR", requestId: "req-1" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("POST /things");
    expect(spy.mock.calls[0][1]).toBe(boom);
  });

  it("does not console-log the errors it handles as expected ones", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorHandler(new NotFoundError("nope"), request(), fakeReply());

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("apps/api server.ts", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../apps/api/src/server.ts"), "utf8");

  it("registers the global error handler before any plugin or route is registered", () => {
    const handler = src.indexOf("server.setErrorHandler(errorHandler)");

    expect(handler).toBeGreaterThan(-1);
    expect(handler).toBeLessThan(src.indexOf("await registerPlugins(server)"));
    expect(handler).toBeLessThan(src.indexOf("await registerRoutes"));
  });

  it("registers it only once", () => {
    expect(src.match(/setErrorHandler\(/g)).toHaveLength(1);
  });
});
