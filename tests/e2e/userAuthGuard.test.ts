import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync } from "crypto";

import { Container } from "../../apps/api/src/core/container/container";
import { RS256JwtService } from "../../apps/api/src/modules/identity/infrastructure/crypto/JwtService";
import userAuthGuardPlugin from "../../apps/api/src/modules/identity/presentation/plugins/guards/userAuthGuard";
import { UnauthorizedError } from "../../apps/api/src/core/errors/error.format";

// Covers the real credential every dashboard request relies on now that
// apps/web/src/api/wrapper/http.ts no longer sends client-side HMAC
// signing headers (removed 2026-09-15 -- see decision.md,
// "NEXT_PUBLIC_SECRET_KEY removal"). Those headers were never checked by
// anything server-side (apps/api's only signature checker,
// signatureVerification in core/utils/auth.util.ts, was never wired onto
// any route), so removing them changed nothing about what actually
// protects these endpoints -- this test locks in that the real protection
// (userAuthGuard, verifying a Bearer JWT) still works correctly on its own.
//
// Note this is a Bearer token, not a cookie: investigated directly before
// writing this test, since the original task brief assumed a cookie-based
// session. userAuthGuard reads only request.headers.authorization;
// apps/web never sets an access_token cookie anywhere (kept in memory via
// Zustand, excluded even from its own sessionStorage persistence); and the
// one place in apps/api that does a cookie-based JWT check
// (core/middleware/auth.middleware.ts's `authenticate`, using Fastify's
// generic req.jwtVerify() against the `access_token` cookie
// register.plugin.ts configures on @fastify/jwt) has zero importers
// anywhere -- fully dead code, never wired onto any route. context.md's
// Core Flows §5 diagram describes a cookie-based flow that does not match
// the real, live code path; flagged and corrected there.
//
// The plugin is invoked directly rather than through a real Fastify
// server: userAuthGuard.ts's `guard` closure isn't exported standalone,
// and fastify-plugin's fp() wrapper returns the same function unchanged
// (just tagged with registration metadata), so calling it with a minimal
// fake FastifyInstance -- exposing only what this plugin actually reads
// (`.container`) and writes (`.decorate`) -- exercises the identical
// guard logic without needing a real fastify boot. `fastify` itself isn't
// resolvable from a bare import under tests/e2e/ given this repo's
// pnpm-isolated node_modules layout (it lives only in
// apps/api/node_modules), and adding it as a duplicate root devDependency
// just for one test risked drifting from apps/api's real version over
// time -- this approach avoids both problems and matches this suite's
// existing pure-function testing style (see internalProxyAuth.test.ts).

describe("userAuthGuard - the real protection dashboard requests rely on", () => {
  let guard: (request: any, reply: any) => Promise<void>;
  let validToken: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const jwtService = new RS256JwtService(privateKey, publicKey);

    validToken = jwtService.sign(
      { sub: "user-1", email: "test@example.com" },
      { expiresIn: "15m" },
    );

    const container = new Container();

    container.register(RS256JwtService, () => jwtService);

    const fakeFastify: any = { container };

    fakeFastify.decorate = (name: string, value: unknown) => {
      fakeFastify[name] = value;
    };

    await (userAuthGuardPlugin as any)(fakeFastify);
    guard = fakeFastify.userAuthGuard;
  });

  it("rejects a request with no Authorization header", async () => {
    const request: any = { headers: {} };

    await expect(guard(request, {})).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a header missing the Bearer prefix", async () => {
    const request: any = { headers: { authorization: validToken } };

    await expect(guard(request, {})).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a tampered token", async () => {
    const request: any = { headers: { authorization: `Bearer ${validToken}tampered` } };

    await expect(guard(request, {})).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a token signed by a different key pair", async () => {
    const { publicKey: foreignPublic, privateKey: foreignPrivate } =
      generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

    const foreignToken = new RS256JwtService(foreignPrivate, foreignPublic).sign({
      sub: "attacker",
      email: "attacker@example.com",
    });

    const request: any = { headers: { authorization: `Bearer ${foreignToken}` } };

    await expect(guard(request, {})).rejects.toThrow(UnauthorizedError);
  });

  it("accepts a real, validly-signed Bearer token and populates request.user", async () => {
    const request: any = { headers: { authorization: `Bearer ${validToken}` } };

    await expect(guard(request, {})).resolves.toBeUndefined();
    expect(request.user).toMatchObject({ sub: "user-1", userId: "user-1", email: "test@example.com" });
  });
});
