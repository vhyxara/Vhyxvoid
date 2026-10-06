// packages/agent/src/mockServer.ts
//
// `vhyxvoid mock <file>`: serves a mock API on this machine, offline, with the
// same engine the platform uses (@vhyxvoid/shared/mock). The file is a mock
// exported from the dashboard (VhyxVoid JSON) or any JSON document the
// dashboard can import: OpenAPI 3 / Swagger 2, a Postman collection, a Mockoon
// environment or a HAR file. Resources keep their data in memory while the
// server runs. The file is watched and reloaded when it changes.

import * as fs from "fs";
import * as http from "http";
import {
  MemoryResourceStore,
  importMockDocument,
  mockHandles,
  resolveMock,
  resolveResource,
  resourceHandles,
  type MockApiDefinition,
  type MockImport,
} from "@vhyxvoid/shared/mock";

export interface MockServerOptions {
  file: string;
  port: number;
  host: string;
  /** Print one line per request. */
  log?: (line: string) => void;
}

export interface LoadedMock {
  def: MockApiDefinition;
  name: string;
  format: MockImport["format"];
  warnings: string[];
}

/** Reads and imports a mock file; throws a readable Error. */
export function loadMockFile(file: string): LoadedMock {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`Cannot read ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not JSON. Export the mock from the dashboard as "VhyxVoid JSON" or "OpenAPI (JSON)", or convert YAML to JSON first.`);
  }
  const imported = importMockDocument(doc);
  return {
    def: {
      id: `local:${file}`,
      mode: "ALWAYS",
      cors: imported.settings?.cors ?? true,
      latencyMs: imported.settings?.latencyMs ?? 0,
      endpoints: imported.endpoints,
      resources: imported.resources,
    },
    name: imported.title,
    format: imported.format,
    warnings: imported.warnings,
  };
}

function readBody(req: http.IncomingMessage, max = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startMockServer(opts: MockServerOptions): Promise<{ server: http.Server; reload: () => LoadedMock; current: () => LoadedMock }> {
  let mock = loadMockFile(opts.file);
  let sequence = new Map<string, number>();
  let store = new MemoryResourceStore();
  const log = opts.log ?? (() => {});

  // Imports give resources fresh ids; compare what they are, not their ids.
  const shape = (d: MockApiDefinition) => JSON.stringify((d.resources ?? []).map(({ id: _id, ...rest }) => rest));
  const reload = () => {
    const next = loadMockFile(opts.file);
    // Resource data survives a reload unless the resources themselves changed
    // (same resources: keep their ids, which key the data).
    if (shape(next.def) === shape(mock.def)) next.def.resources = mock.def.resources;
    else store = new MemoryResourceStore();
    mock = next;
    sequence = new Map();
    return mock;
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    try {
      const body = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(req);
      const mreq = { method, url, headers: req.headers, body: body.length ? body.toString("utf8") : undefined };
      const def = mock.def;
      const answer = mockHandles(def, mreq)
        ? resolveMock(def, mreq, { sequence })
        : resourceHandles(def, mreq)
          ? await resolveResource(def, mreq, store, { mockId: def.id ?? "local" })
          : null;
      if (!answer) {
        const payload = JSON.stringify({ error: `No mock endpoint matches ${method} ${url.split("?")[0]}`, code: "MOCK_NO_ROUTE" });
        res.writeHead(404, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "x-vhyxvoid-error": "MOCK_NO_ROUTE" });
        res.end(payload);
        log(`${method} ${url} → 404 (no endpoint)`);
        return;
      }
      if (answer.latencyMs > 0) await new Promise((r) => setTimeout(r, answer.latencyMs));
      const noBody = method === "HEAD" || answer.status === 204 || answer.status === 304;
      const payload = noBody ? Buffer.alloc(0) : Buffer.from(answer.body, "utf8");
      res.writeHead(answer.status, { ...answer.headers, "content-length": String(payload.length), "x-vhyxvoid-mock": answer.endpointId });
      res.end(payload.length ? payload : undefined);
      const ep = def.endpoints.find((e) => e.id === answer.endpointId);
      const what = ep ? ep.name || `${ep.method} ${ep.path}` : answer.endpointId.startsWith("resource:") ? `resource ${def.resources?.find((r) => `resource:${r.id}` === answer.endpointId)?.name ?? ""} ${answer.responseId}` : answer.endpointId;
      log(`${method} ${url} → ${answer.status} (${what}) ${Date.now() - started} ms`);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead((err as Error).message === "too large" ? 413 : 500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      log(`${method} ${url} → error: ${(err as Error).message}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve({ server, reload, current: () => mock }));
  });
}
