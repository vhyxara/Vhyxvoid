import { describe, it, expect } from "vitest";
import {
  TunnelClient,
  TunnelError,
  TunnelTimeoutError,
  createClient,
  VhyxvoidClient,
  ClientError,
} from "../../packages/sdk/src/index";

// Covers context.md risk #12: packages/sdk/src/index.ts (the barrel a real
// consumer imports from) previously only exported TunnelClient — client.ts's
// createClient/VhyxvoidClient/ClientError existed and were "confirmed fully
// implemented" per the SDK Client Strategy section, but were unreachable via
// the package's actual public entry point. This is a smoke test of the
// export surface itself, not new logic — no network call, just confirming a
// fresh consumer of "@vhyxvoid/sdk" (here, its source barrel directly, same
// convention as this suite's other tests) can actually reach both.

describe("packages/sdk barrel — index.ts exports", () => {
  it("exports createClient and can construct a working VhyxvoidClient", () => {
    expect(typeof createClient).toBe("function");

    const client = createClient({ baseUrl: "http://127.0.0.1:1" });

    expect(client).toBeInstanceOf(VhyxvoidClient);
    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(client.getBaseUrl()).toBe("http://127.0.0.1:1");
  });

  it("exports ClientError", () => {
    const err = new ClientError(404, { message: "not found" }, "http://x");
    expect(err).toBeInstanceOf(ClientError);
    expect(err.status).toBe(404);
  });

  it("still exports TunnelClient (WS client) alongside the HTTP client — adding client.ts's exports didn't disturb it", () => {
    expect(typeof TunnelClient).toBe("function");

    const client = new TunnelClient({
      hubUrl: "ws://127.0.0.1:1",
      keyId: "key_1",
      secret: "s".repeat(32),
      localDiscovery: false,
    });

    expect(client.isConnected()).toBe(false);
    expect(typeof client.get).toBe("function");
  });

  it("still exports TunnelError/TunnelTimeoutError", () => {
    expect(typeof TunnelError).toBe("function");
    expect(typeof TunnelTimeoutError).toBe("function");
    const err = new TunnelTimeoutError("req_1");
    expect(err).toBeInstanceOf(TunnelError);
  });
});
