// createClient sends through the fetch it is given (a proxy agent, custom
// DNS, a test stub), and through the global fetch otherwise.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "../../packages/sdk/src/index";

afterEach(() => vi.unstubAllGlobals());

describe("createClient's fetch", () => {
  it("uses the fetch passed in", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const client = createClient({
      baseUrl: "https://acme--api.vhyxvoid.test/",
      fetch: async (url, init) => (calls.push([String(url), init ?? {}]), new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
    });
    const r = await client.post("/orders", { id: 1 });
    expect(r).toMatchObject({ status: 200, data: { ok: true } });
    expect(calls[0][0]).toBe("https://acme--api.vhyxvoid.test/orders");
    expect(calls[0][1]).toMatchObject({ method: "POST", body: '{"id":1}' });
  });

  it("falls back to the global fetch", async () => {
    const global = vi.fn(async () => new Response("hi", { status: 200, headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", global);
    const r = await createClient({ baseUrl: "https://x.test" }).get("/");
    expect(r.data).toBe("hi");
    expect(global).toHaveBeenCalledOnce();
  });
});
