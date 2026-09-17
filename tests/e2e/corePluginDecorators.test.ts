import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "crypto";

import { Container } from "../../apps/api/src/core/container/container";
import { PrismaUnitOfWork } from "../../apps/api/src/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { RS256JwtService } from "../../apps/api/src/modules/identity/infrastructure/crypto/JwtService";
import corePlugin from "../../apps/api/src/modules/identity/presentation/plugins/infrastructure/core.plugin";

// Regression test for context.md item 49 / decision.md, 2026-09-17:
// fastify.jwtService and fastify.uow were both declared in fastify.d.ts
// and read directly by adminAuthGuard.plugin.ts / most of admin.routes.ts,
// but core.plugin.ts (the plugin responsible for decorating them) never
// actually did -- every adminAuthGuard-gated request 403'd and every
// fastify.uow-touching admin route 500'd, and nothing caught it until a
// real functional smoke test against the live backend surfaced it. This
// test locks in the fix (core.plugin.ts now decorates both, right after
// each is registered in the container) so a future refactor of
// core.plugin.ts or registerPlugins' ordering can't silently reintroduce
// the same gap without a test failing first.
//
// core.plugin.ts is invoked directly against a minimal fake FastifyInstance
// (real .decorate(), real Container, a stubbed .prisma), the same
// established pattern userAuthGuard.test.ts already uses for this class of
// plugin -- a real fastify server isn't resolvable from a bare import
// under tests/e2e/ (it lives only in apps/api/node_modules), and this
// plugin's only real dependencies are fastify.container and fastify.prisma,
// both trivially fakeable without needing a live database.

describe("core.plugin.ts — fastify.jwtService/fastify.uow decorators", () => {
  let fastify: any;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // core.plugin.ts reads PRIVATE_KEY_B64/PUBLIC_KEY_B64 (or the raw
    // PRIVATE_KEY/PUBLIC_KEY variants) via resolveRsaKey() -- base64 avoids
    // any filesystem dependency in the test.
    process.env.PRIVATE_KEY_B64 = Buffer.from(privateKey).toString("base64");
    process.env.PUBLIC_KEY_B64 = Buffer.from(publicKey).toString("base64");
    delete process.env.PRIVATE_KEY;
    delete process.env.PUBLIC_KEY;

    const container = new Container();

    fastify = {
      container,
      prisma: {}, // PrismaUnitOfWork's constructor only stores this, never calls it
    };
    fastify.decorate = (name: string, value: unknown) => {
      fastify[name] = value;
    };

    await (corePlugin as any)(fastify);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("decorates fastify.uow with a real, usable PrismaUnitOfWork", () => {
    expect(fastify.uow).toBeInstanceOf(PrismaUnitOfWork);
    // The exact bug this session's sweep traced item 49's fix back to:
    // admin.routes.ts reads fastify.uow.adminUserRepository directly (not
    // through a use case) -- confirm that real nested access works, not
    // just that fastify.uow itself is truthy.
    expect(fastify.uow.adminUserRepository).toBeDefined();
    expect(fastify.uow.membershipRepository).toBeDefined();
    expect(fastify.uow.tunnelSessionRepository).toBeDefined();
    expect(fastify.uow.tunnelRequestRepository).toBeDefined();
  });

  it("decorates fastify.jwtService with a real, working RS256JwtService", () => {
    expect(fastify.jwtService).toBeInstanceOf(RS256JwtService);

    // Functional check, not just "is defined" -- sign and verify a real
    // token through the decorated instance, the exact call
    // adminAuthGuard.plugin.ts makes on every request.
    const token = fastify.jwtService.sign({ sub: "admin-1", type: "admin" });
    const payload = fastify.jwtService.verify(token);

    expect(payload).toMatchObject({ sub: "admin-1", type: "admin" });
  });

  it("fastify.uow and fastify.jwtService are the SAME instances the DI container resolves (no second, divergent copy)", () => {
    expect(fastify.uow).toBe(fastify.container.resolve(PrismaUnitOfWork));
    expect(fastify.jwtService).toBe(fastify.container.resolve(RS256JwtService));
  });
});
