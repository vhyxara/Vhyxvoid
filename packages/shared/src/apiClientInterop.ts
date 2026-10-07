// packages/shared/src/apiClientInterop.ts
//
// Getting requests into and out of the API client (api-platform-plan.md,
// phase 3):
//
//   - parseCurl: paste a curl command, get a request (method, headers, auth,
//     body, form fields);
//   - importApiCollection: a VhyxVoid collection file, a Postman collection
//     (v2.0/v2.1, folders, auth, bodies, variables), OpenAPI 3 / Swagger 2 (one
//     request per operation, example bodies, {{baseUrl}}) or a HAR file;
//   - collectionFromMock: requests that test a mock API, with a status check
//     for each endpoint's default response;
//   - exportPostmanCollection / nativeCollectionFile for the other direction
//     (the native file is what `vhyxvoid test` reads in CI).

import {
  API_METHODS,
  apiId,
  newApiRequest,
  type ApiAuth,
  type ApiBody,
  type ApiCollection,
  type ApiFolder,
  type ApiKeyValue,
  type ApiMethod,
  type ApiRequest,
  type ApiVariable,
} from "./apiClient";
import { sampleFromSchema, type MockApiDefinition } from "./mockApi";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : v === undefined || v === null ? fallback : String(v));
const asMethod = (m: unknown): ApiMethod => {
  const up = str(m, "GET").toUpperCase();
  return (API_METHODS as readonly string[]).includes(up) ? (up as ApiMethod) : "GET";
};

// ── curl ─────────────────────────────────────────────────────────────────────

/** Splits a shell command line the way sh would (quotes, backslash escapes, line continuations). */
export function shellWords(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let i = 0;
  const s = cmd.replace(/\\\r?\n/g, " ");
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, end === -1 ? s.length : end);
      has = true;
      i = end === -1 ? s.length : end + 1;
    } else if (c === "$" && s[i + 1] === "'") {
      // $'...' with \n \t \' escapes
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          cur += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
          i += 2;
        } else cur += s[i++];
      }
      i++;
      has = true;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else cur += s[i++];
      }
      i++;
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
      i++;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

export interface CurlImport {
  request: ApiRequest;
  warnings: string[];
}

/** A request from a curl command (as copied from browser dev tools or API docs). */
export function parseCurl(cmd: string): CurlImport {
  const words = shellWords(cmd.trim());
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) throw new Error('Paste a command that starts with "curl"');
  const warnings: string[] = [];
  let method: string | null = null;
  let url = "";
  const headers: ApiKeyValue[] = [];
  const data: string[] = [];
  const form: { key: string; value: string; file?: string }[] = [];
  let auth: ApiAuth = { type: "none" };
  let get = false;
  let head = false;
  const takesValue = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "--json", "-F", "--form", "--form-string", "-u", "--user", "-A", "--user-agent", "-b", "--cookie", "-e", "--referer", "--url", "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "-w", "--write-out", "--retry", "-T", "--upload-file", "--oauth2-bearer"]);
  for (let i = 1; i < words.length; i++) {
    let w = words[i];
    let val: string | undefined;
    if (w.startsWith("--") && w.includes("=")) {
      val = w.slice(w.indexOf("=") + 1);
      w = w.slice(0, w.indexOf("="));
    } else if (/^-[A-Za-z]./.test(w) && takesValue.has(w.slice(0, 2))) {
      val = w.slice(2);
      w = w.slice(0, 2);
    }
    const next = () => val ?? words[++i] ?? "";
    switch (w) {
      case "-X":
      case "--request":
        method = next().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = next();
        const c = h.indexOf(":");
        if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim(), enabled: true });
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii": {
        const d = next();
        if (d.startsWith("@") && w !== "--data-raw") warnings.push(`The body comes from the file ${d.slice(1)}; paste its content into the body`);
        else data.push(d);
        break;
      }
      case "--data-urlencode": {
        const d = next();
        const eq = d.indexOf("=");
        data.push(eq === -1 ? encodeURIComponent(d) : `${d.slice(0, eq)}=${encodeURIComponent(d.slice(eq + 1))}`);
        break;
      }
      case "--json":
        data.push(next());
        headers.push({ key: "Content-Type", value: "application/json", enabled: true }, { key: "Accept", value: "application/json", enabled: true });
        break;
      case "-F":
      case "--form":
      case "--form-string": {
        const f = next();
        const eq = f.indexOf("=");
        if (eq === -1) break;
        const key = f.slice(0, eq);
        const value = f.slice(eq + 1);
        if (value.startsWith("@") && w !== "--form-string") {
          form.push({ key, value: "", file: value.slice(1).split(";")[0] });
          warnings.push(`Pick the file for "${key}" (${value.slice(1).split(";")[0]}) in the body tab`);
        } else form.push({ key, value: value.startsWith("<") ? "" : value });
        break;
      }
      case "-u":
      case "--user": {
        const u = next();
        const c = u.indexOf(":");
        auth = { type: "basic", username: c === -1 ? u : u.slice(0, c), password: c === -1 ? "" : u.slice(c + 1) };
        break;
      }
      case "--oauth2-bearer":
        auth = { type: "bearer", token: next() };
        break;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: next(), enabled: true });
        break;
      case "-b":
      case "--cookie":
        headers.push({ key: "Cookie", value: next(), enabled: true });
        break;
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: next(), enabled: true });
        break;
      case "-G":
      case "--get":
        get = true;
        break;
      case "-I":
      case "--head":
        head = true;
        break;
      case "--url":
        url = next();
        break;
      case "-T":
      case "--upload-file":
        warnings.push(`Uploads ${next()}; choose the file in the body tab`);
        method ??= "PUT";
        break;
      case "--compressed":
      case "-s":
      case "--silent":
      case "-S":
      case "--show-error":
      case "-k":
      case "--insecure":
      case "-L":
      case "--location":
      case "-v":
      case "--verbose":
      case "-i":
      case "--include":
      case "-f":
      case "--fail":
      case "-sS":
      case "-sL":
      case "-fsSL":
        break;
      default:
        if (takesValue.has(w)) {
          next();
          break;
        }
        if (w.startsWith("-")) {
          warnings.push(`Ignored the option ${w}`);
          break;
        }
        if (!url) url = w;
    }
  }
  if (!url) throw new Error("The curl command has no URL");
  // An Authorization header becomes the matching auth helper.
  const authIdx = headers.findIndex((h) => h.key.toLowerCase() === "authorization");
  if (authIdx !== -1 && auth.type === "none") {
    const v = headers[authIdx].value;
    if (/^bearer\s+/i.test(v)) {
      auth = { type: "bearer", token: v.replace(/^bearer\s+/i, "") };
      headers.splice(authIdx, 1);
    } else if (/^basic\s+/i.test(v)) {
      try {
        const decoded = Buffer.from(v.replace(/^basic\s+/i, ""), "base64").toString("utf8");
        const c = decoded.indexOf(":");
        if (c !== -1) {
          auth = { type: "basic", username: decoded.slice(0, c), password: decoded.slice(c + 1) };
          headers.splice(authIdx, 1);
        }
      } catch {
        /* keep the header */
      }
    }
  }
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`);
  } catch {
    /* kept as typed */
  }
  const params: ApiKeyValue[] = [];
  let baseUrl = url;
  if (parsedUrl) {
    for (const [k, v] of parsedUrl.searchParams) params.push({ key: k, value: v, enabled: true });
    parsedUrl.search = "";
    baseUrl = /^[a-z]+:\/\//i.test(url) ? parsedUrl.toString() : parsedUrl.toString().replace(/^http:\/\//, "");
  }
  let body: ApiBody = { type: "none" };
  const joined = data.join("&");
  if (get && data.length) {
    for (const pair of joined.split("&")) {
      const eq = pair.indexOf("=");
      params.push({ key: decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq)), value: eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")), enabled: true });
    }
  } else if (form.length) {
    body = { type: "multipart", fields: form.map((f) => ({ key: f.key, value: f.value, enabled: true, ...(f.file ? { file: { name: f.file, contentType: "application/octet-stream", base64: "" } } : {}) })) };
  } else if (data.length) {
    const ctIdx = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
    const ct = ctIdx === -1 ? "" : headers[ctIdx].value.toLowerCase();
    const text = data.length === 1 ? data[0] : joined;
    let isJson = ct.includes("json");
    if (!ct) {
      try {
        JSON.parse(text);
        isJson = /^\s*[[{]/.test(text);
      } catch {
        isJson = false;
      }
    }
    if (isJson) {
      body = { type: "json", text: prettyJson(text) };
      if (ctIdx !== -1 && ct === "application/json") headers.splice(ctIdx, 1);
    } else if (!ct || ct.includes("x-www-form-urlencoded")) {
      body = {
        type: "form",
        fields: joined.split("&").filter(Boolean).map((pair) => {
          const eq = pair.indexOf("=");
          const dec = (x: string) => {
            try {
              return decodeURIComponent(x.replace(/\+/g, " "));
            } catch {
              return x;
            }
          };
          return { key: dec(eq === -1 ? pair : pair.slice(0, eq)), value: eq === -1 ? "" : dec(pair.slice(eq + 1)), enabled: true };
        }),
      };
      if (ctIdx !== -1) headers.splice(ctIdx, 1);
    } else {
      body = { type: "raw", text, contentType: headers[ctIdx].value };
      headers.splice(ctIdx, 1);
    }
  }
  const m = method ?? (head ? "HEAD" : data.length && !get ? "POST" : form.length ? "POST" : "GET");
  if (!(API_METHODS as readonly string[]).includes(m)) warnings.push(`Method ${m} isn't supported; using GET`);
  let name = `${asMethod(m)} ${parsedUrl ? parsedUrl.pathname : url}`;
  if (name.length > 120) name = name.slice(0, 119) + "…";
  return { request: newApiRequest({ name, method: asMethod(m), url: baseUrl, params, headers, auth, body }), warnings };
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// ── Native file ──────────────────────────────────────────────────────────────

export interface NativeCollectionFile {
  vhyxvoid: "collection";
  version: 1;
  exportedAt: string;
  collection: ApiCollection;
  /** Optional environments; secret values are left empty in exports. */
  environments?: { name: string; variables: ApiVariable[] }[];
}

export function nativeCollectionFile(collection: ApiCollection, environments: { name: string; variables: ApiVariable[] }[] = []): NativeCollectionFile {
  return {
    vhyxvoid: "collection",
    version: 1,
    exportedAt: new Date().toISOString(),
    collection,
    environments: environments.map((e) => ({ name: e.name, variables: e.variables.map((v) => (v.secret ? { ...v, value: "" } : v)) })),
  };
}

// ── Postman ──────────────────────────────────────────────────────────────────

function postmanKv(list: unknown): ApiKeyValue[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((h) => ({ key: str(h.key), value: str(h.value), enabled: h.disabled !== true }));
}

function postmanAuthValue(list: unknown, key: string): string {
  if (Array.isArray(list)) return str(list.filter(isObj).find((x) => x.key === key)?.value);
  if (isObj(list)) return str(list[key]);
  return "";
}

function fromPostmanAuth(a: unknown, warnings: string[], where: string): ApiAuth | null {
  if (!isObj(a)) return null;
  const type = str(a.type);
  const bag = a[type];
  switch (type) {
    case "noauth":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: postmanAuthValue(bag, "token") };
    case "basic":
      return { type: "basic", username: postmanAuthValue(bag, "username"), password: postmanAuthValue(bag, "password") };
    case "apikey":
      return { type: "apiKey", name: postmanAuthValue(bag, "key") || "X-API-Key", value: postmanAuthValue(bag, "value"), in: postmanAuthValue(bag, "in") === "query" ? "query" : "header" };
    default:
      warnings.push(`${where}: ${type} auth isn't supported yet; set it again in the Auth tab`);
      return null;
  }
}

function fromPostmanBody(b: unknown, headers: ApiKeyValue[], warnings: string[], where: string): ApiBody {
  if (!isObj(b)) return { type: "none" };
  switch (b.mode) {
    case "raw": {
      const text = str(b.raw);
      const lang = isObj(b.options) && isObj(b.options.raw) ? str(b.options.raw.language) : "";
      const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
      if (lang === "json" || ct.includes("json")) return { type: "json", text };
      return { type: "raw", text, contentType: ct || (lang === "xml" ? "application/xml" : "text/plain") };
    }
    case "urlencoded":
      return { type: "form", fields: postmanKv(b.urlencoded) };
    case "formdata":
      return {
        type: "multipart",
        fields: (Array.isArray(b.formdata) ? b.formdata : []).filter(isObj).map((f) => {
          if (f.type === "file") warnings.push(`${where}: pick the file for "${str(f.key)}" again`);
          return { key: str(f.key), value: f.type === "file" ? "" : str(f.value), enabled: f.disabled !== true, ...(f.type === "file" ? { file: { name: str(f.src, "file").split(/[\\/]/).pop() || "file", contentType: str(f.contentType, "application/octet-stream"), base64: "" } } : {}) };
        }),
      };
    case "graphql": {
      const g = isObj(b.graphql) ? b.graphql : {};
      return { type: "graphql", query: str(g.query), variables: str(g.variables) };
    }
    case "file":
      warnings.push(`${where}: pick the body file again`);
      return { type: "file", name: "file", contentType: "application/octet-stream", base64: "" };
    default:
      return { type: "none" };
  }
}

function postmanUrlString(url: unknown): { url: string; params: ApiKeyValue[] } {
  if (typeof url === "string") return splitQuery(url);
  if (!isObj(url)) return { url: "", params: [] };
  const raw = str(url.raw);
  if (raw) {
    const s = splitQuery(raw);
    if (Array.isArray(url.query)) s.params = postmanKv(url.query);
    return s;
  }
  const host = Array.isArray(url.host) ? url.host.join(".") : str(url.host);
  const path = Array.isArray(url.path) ? url.path.map((p) => (isObj(p) ? str(p.value) : str(p))).join("/") : str(url.path);
  const proto = url.protocol ? `${str(url.protocol)}://` : "";
  return { url: `${proto}${host}${path ? `/${path}` : ""}`, params: postmanKv(url.query) };
}

function splitQuery(raw: string): { url: string; params: ApiKeyValue[] } {
  const q = raw.indexOf("?");
  if (q === -1) return { url: raw, params: [] };
  const params = raw
    .slice(q + 1)
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const dec = (x: string) => {
        try {
          return decodeURIComponent(x);
        } catch {
          return x;
        }
      };
      return { key: dec(eq === -1 ? pair : pair.slice(0, eq)), value: eq === -1 ? "" : dec(pair.slice(eq + 1)), enabled: true };
    });
  return { url: raw.slice(0, q), params };
}

/** Postman's :param path variables become {{param}} (collection variables). */
function postmanPathVars(url: string): string {
  return url.replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, "/{{$1}}");
}

/** Postman test scripts that are just pm.response.to.have.status(N) become a status check. */
function scriptChecks(events: unknown, warnings: string[], where: string): ApiRequest["assertions"] {
  if (!Array.isArray(events)) return [];
  const out: ApiRequest["assertions"] = [];
  for (const e of events.filter(isObj)) {
    if (e.listen !== "test" || !isObj(e.script)) continue;
    const exec = Array.isArray(e.script.exec) ? e.script.exec.join("\n") : str(e.script.exec);
    const m = /pm\.response\.to\.have\.status\((\d{3})\)/.exec(exec);
    if (m) out.push({ id: apiId("a"), enabled: true, source: "status", op: "eq", value: m[1] });
    if (exec.trim() && !m) warnings.push(`${where}: test scripts don't run here; add checks in the Tests tab`);
    else if (exec.replace(/pm\.test\([^]*?pm\.response\.to\.have\.status\(\d{3}\);?\s*\}\);?/g, "").trim()) warnings.push(`${where}: only the status check of its test script was kept`);
  }
  return out;
}

function importPostmanCollection(doc: Json): ImportedCollection {
  const warnings: string[] = [];
  const folders: ApiFolder[] = [];
  const requests: ApiRequest[] = [];
  const walk = (items: unknown[], parentId: string | null) => {
    for (const it of items) {
      if (!isObj(it)) continue;
      if (Array.isArray(it.item)) {
        const id = apiId("f");
        folders.push({ id, name: str(it.name, "Folder").slice(0, 80) || "Folder", parentId });
        walk(it.item, id);
        continue;
      }
      const req = isObj(it.request) ? it.request : typeof it.request === "string" ? { url: it.request } : null;
      if (!req) continue;
      const name = str(it.name, "Request").slice(0, 120) || "Request";
      const headers = postmanKv(req.header);
      const { url, params } = postmanUrlString(req.url);
      const auth = fromPostmanAuth(req.auth, warnings, name) ?? { type: "inherit" as const };
      const body = fromPostmanBody(req.body, headers, warnings, name);
      if (body.type === "json") {
        const i = headers.findIndex((h) => h.key.toLowerCase() === "content-type" && h.value.toLowerCase() === "application/json");
        if (i !== -1) headers.splice(i, 1);
      }
      const pre = Array.isArray(it.event) && it.event.some((e) => isObj(e) && e.listen === "prerequest" && isObj(e.script) && str(Array.isArray(e.script.exec) ? e.script.exec.join("") : e.script.exec).trim());
      if (pre) warnings.push(`${name}: pre-request scripts don't run here`);
      requests.push(newApiRequest({ name, method: asMethod(req.method), url: postmanPathVars(url), params, headers, auth, body, folderId: parentId, description: str(req.description).slice(0, 2000), assertions: scriptChecks(it.event, warnings, name) }));
    }
  };
  walk(Array.isArray(doc.item) ? doc.item : [], null);
  const info = isObj(doc.info) ? doc.info : {};
  const variables: ApiVariable[] = (Array.isArray(doc.variable) ? doc.variable : []).filter(isObj).filter((v) => str(v.key)).map((v) => ({ key: str(v.key), value: str(v.value), enabled: v.disabled !== true }));
  const auth = fromPostmanAuth(doc.auth, warnings, "Collection") ?? { type: "none" as const };
  return { format: "postman", collection: { name: str(info.name, "Postman collection").slice(0, 80), description: str(info.description).slice(0, 2000), auth: auth.type === "inherit" ? { type: "none" } : auth, variables, folders, requests }, environments: [], warnings };
}

function toPostmanAuth(a: ApiAuth): Json | undefined {
  switch (a.type) {
    case "none":
      return { type: "noauth" };
    case "bearer":
      return { type: "bearer", bearer: [{ key: "token", value: a.token, type: "string" }] };
    case "basic":
      return { type: "basic", basic: [{ key: "username", value: a.username, type: "string" }, { key: "password", value: a.password, type: "string" }] };
    case "apiKey":
      return { type: "apikey", apikey: [{ key: "key", value: a.name, type: "string" }, { key: "value", value: a.value, type: "string" }, { key: "in", value: a.in, type: "string" }] };
    default:
      return undefined;
  }
}

function toPostmanBody(b: ApiBody): Json | undefined {
  switch (b.type) {
    case "json":
      return { mode: "raw", raw: b.text, options: { raw: { language: "json" } } };
    case "raw":
      return { mode: "raw", raw: b.text };
    case "graphql":
      return { mode: "graphql", graphql: { query: b.query, variables: b.variables } };
    case "form":
      return { mode: "urlencoded", urlencoded: b.fields.map((f) => ({ key: f.key, value: f.value, disabled: !f.enabled || undefined })) };
    case "multipart":
      return { mode: "formdata", formdata: b.fields.map((f) => (f.file ? { key: f.key, type: "file", src: f.file.name, disabled: !f.enabled || undefined } : { key: f.key, value: f.value, type: "text", disabled: !f.enabled || undefined })) };
    case "file":
      return { mode: "file", file: { src: b.name } };
    default:
      return undefined;
  }
}

/** Postman collection v2.1 (checks become pm.test scripts so they still run there). */
export function exportPostmanCollection(col: ApiCollection): Json {
  const toItem = (r: ApiRequest): Json => {
    const tests = r.assertions.filter((a) => a.enabled).map((a) => postmanTest(a)).filter(Boolean) as string[];
    const headers: Json[] = r.headers.map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled || undefined }));
    if (r.body.type === "json" && !r.headers.some((h) => h.key.toLowerCase() === "content-type")) headers.push({ key: "Content-Type", value: "application/json" });
    return {
      name: r.name,
      request: {
        method: r.method,
        header: headers,
        url: { raw: r.url + (r.params.some((p) => p.enabled) ? `?${r.params.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join("&")}` : ""), query: r.params.map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled || undefined })) },
        ...(r.auth.type !== "inherit" && toPostmanAuth(r.auth) ? { auth: toPostmanAuth(r.auth) } : {}),
        ...(toPostmanBody(r.body) ? { body: toPostmanBody(r.body) } : {}),
        ...(r.description ? { description: r.description } : {}),
      },
      ...(tests.length ? { event: [{ listen: "test", script: { type: "text/javascript", exec: tests } }] } : {}),
    };
  };
  const folderItems = (parent: string | null): Json[] => [
    ...col.folders.filter((f) => (f.parentId ?? null) === parent).map((f) => ({ name: f.name, item: folderItems(f.id) })),
    ...col.requests.filter((r) => (r.folderId ?? null) === parent).map(toItem),
  ];
  return {
    info: { name: col.name, description: col.description ?? "", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: folderItems(null),
    ...(toPostmanAuth(col.auth) && col.auth.type !== "none" ? { auth: toPostmanAuth(col.auth) } : {}),
    variable: col.variables.map((v) => ({ key: v.key, value: v.secret ? "" : v.value, disabled: !v.enabled || undefined })),
  };
}

function postmanTest(a: ApiRequest["assertions"][number]): string | null {
  const v = JSON.stringify(a.value ?? "");
  const name = JSON.stringify(`${a.source}${a.path ? ` ${a.path}` : ""} ${a.op} ${a.value ?? ""}`.trim());
  const pathExpr = (p: string) =>
    "pm.response.json()" +
    (parseSimplePath(p) ?? [])
      .map((k) => (typeof k === "number" ? `[${k}]` : `[${JSON.stringify(k)}]`))
      .join("");
  if (a.source === "status" && a.op === "eq") return `pm.test(${name}, () => pm.response.to.have.status(${Number(a.value)}));`;
  if (a.source === "time" && (a.op === "lt" || a.op === "lte")) return `pm.test(${name}, () => pm.expect(pm.response.responseTime).to.be.${a.op === "lt" ? "below" : "most"}(${Number(a.value)}));`;
  if (a.source === "header" && a.op === "exists") return `pm.test(${name}, () => pm.response.to.have.header(${JSON.stringify(a.path ?? "")}));`;
  if (a.source === "header" && a.op === "eq") return `pm.test(${name}, () => pm.expect(pm.response.headers.get(${JSON.stringify(a.path ?? "")})).to.eql(${v}));`;
  if (a.source === "body" && a.op === "contains") return `pm.test(${name}, () => pm.expect(pm.response.text()).to.include(${v}));`;
  if (a.source === "json" && parseSimplePath(a.path ?? "$")) {
    if (a.op === "exists") return `pm.test(${name}, () => pm.expect(${pathExpr(a.path ?? "$")}).to.not.be.undefined);`;
    if (a.op === "eq") return `pm.test(${name}, () => pm.expect(${pathExpr(a.path ?? "$")}).to.eql(${safeLiteral(a.value ?? "")}));`;
  }
  return null;
}

function safeLiteral(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return JSON.stringify(text);
  }
}

function parseSimplePath(p: string): (string | number)[] | null {
  const s = p.replace(/^\$\.?/, "");
  if (!s) return [];
  const out: (string | number)[] = [];
  for (const part of s.split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== "")) {
    if (/^\d+$/.test(part)) out.push(Number(part));
    else if (/^[A-Za-z_$][\w$-]*$/.test(part)) out.push(part);
    else return null;
  }
  return out;
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

const OA_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function resolveLocal(spec: Json, node: unknown): Json | undefined {
  let cur: unknown = node;
  for (let i = 0; i < 10 && isObj(cur) && typeof cur.$ref === "string"; i++) {
    const ref = cur.$ref as string;
    if (!ref.startsWith("#/")) return undefined;
    cur = ref
      .slice(2)
      .split("/")
      .reduce<unknown>((acc, k) => (isObj(acc) ? acc[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), spec);
  }
  return isObj(cur) ? cur : undefined;
}

function importOpenApiCollection(doc: Json): ImportedCollection {
  const isV3 = typeof doc.openapi === "string" && doc.openapi.startsWith("3");
  const warnings: string[] = [];
  const info = isObj(doc.info) ? doc.info : {};
  let baseUrl = "";
  if (isV3 && Array.isArray(doc.servers) && isObj(doc.servers[0])) {
    const server = doc.servers[0] as Json;
    baseUrl = str(server.url).replace(/\{([^}]+)\}/g, (_, name: string) => {
      const vars = isObj(server.variables) ? server.variables : {};
      return str(isObj(vars[name]) ? (vars[name] as Json).default : "");
    });
  } else if (!isV3) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? str(doc.schemes[0]) : "https";
    baseUrl = doc.host ? `${scheme}://${str(doc.host)}${str(doc.basePath).replace(/\/$/, "")}` : str(doc.basePath).replace(/\/$/, "");
  }
  baseUrl = baseUrl.replace(/\/$/, "");
  const variables: ApiVariable[] = [{ key: "baseUrl", value: baseUrl || "https://api.example.com", enabled: true }];
  if (!baseUrl) warnings.push("The document has no server URL; set baseUrl in the collection variables");
  // Security: the first scheme becomes the collection auth.
  let auth: ApiAuth = { type: "none" };
  const schemes = (isV3 ? (isObj(doc.components) ? (doc.components.securitySchemes as Json) : undefined) : (doc.securityDefinitions as Json)) ?? {};
  const first = Object.values(schemes).find(isObj) as Json | undefined;
  if (first) {
    if ((first.type === "http" && str(first.scheme).toLowerCase() === "bearer") || first.type === "oauth2" || first.type === "openIdConnect") {
      auth = { type: "bearer", token: "{{token}}" };
      variables.push({ key: "token", value: "", enabled: true, secret: true });
    } else if ((first.type === "http" && str(first.scheme).toLowerCase() === "basic") || first.type === "basic") {
      auth = { type: "basic", username: "{{username}}", password: "{{password}}" };
      variables.push({ key: "username", value: "", enabled: true }, { key: "password", value: "", enabled: true, secret: true });
    } else if (first.type === "apiKey" && first.in !== "cookie") {
      auth = { type: "apiKey", name: str(first.name, "X-API-Key"), value: "{{apiKey}}", in: first.in === "query" ? "query" : "header" };
      variables.push({ key: "apiKey", value: "", enabled: true, secret: true });
    }
  }
  const folders: ApiFolder[] = [];
  const folderFor = (tag: string | undefined) => {
    if (!tag) return null;
    let f = folders.find((x) => x.name === tag.slice(0, 80));
    if (!f && folders.length < 100) folders.push((f = { id: apiId("f"), name: tag.slice(0, 80), parentId: null }));
    return f?.id ?? null;
  };
  const requests: ApiRequest[] = [];
  const pathVars = new Set<string>();
  for (const [rawPath, itemIn] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    const item = resolveLocal(doc, itemIn);
    if (!item) continue;
    for (const m of OA_METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      const allParams = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => resolveLocal(doc, p)).filter((p): p is Json => !!p);
      const params: ApiKeyValue[] = [];
      const headers: ApiKeyValue[] = [];
      for (const p of allParams) {
        const ex = p.example ?? (isObj(p.schema) ? sampleFromSchema(doc, p.schema) : undefined);
        const value = ex === undefined || ex === null ? "" : typeof ex === "string" ? ex : JSON.stringify(ex);
        if (p.in === "query") params.push({ key: str(p.name), value, enabled: p.required === true });
        else if (p.in === "header") headers.push({ key: str(p.name), value, enabled: p.required === true });
        else if (p.in === "path") pathVars.add(str(p.name));
      }
      let body: ApiBody = { type: "none" };
      if (isV3 && op.requestBody) {
        const rb = resolveLocal(doc, op.requestBody);
        const content = isObj(rb?.content) ? (rb!.content as Json) : {};
        const ct = Object.keys(content).find((c) => c.includes("json")) ?? Object.keys(content)[0];
        if (ct) {
          const media = isObj(content[ct]) ? (content[ct] as Json) : {};
          const ex = media.example ?? (isObj(media.examples) ? resolveLocal(doc, Object.values(media.examples)[0])?.value : undefined) ?? sampleFromSchema(doc, media.schema);
          if (ct.includes("json")) body = { type: "json", text: JSON.stringify(ex ?? {}, null, 2) };
          else if (ct.includes("x-www-form-urlencoded") && isObj(ex)) body = { type: "form", fields: Object.entries(ex).map(([k, v]) => ({ key: k, value: typeof v === "string" ? v : JSON.stringify(v), enabled: true })) };
          else if (ct.includes("multipart") && isObj(ex)) body = { type: "multipart", fields: Object.entries(ex).map(([k, v]) => ({ key: k, value: typeof v === "string" ? v : JSON.stringify(v), enabled: true })) };
          else body = { type: "raw", text: typeof ex === "string" ? ex : "", contentType: ct };
        }
      } else if (!isV3) {
        const bp = allParams.find((p) => p.in === "body");
        if (bp) body = { type: "json", text: JSON.stringify(sampleFromSchema(doc, bp.schema) ?? {}, null, 2) };
      }
      const codes = Object.keys(isObj(op.responses) ? op.responses : {}).filter((c) => /^\d{3}$/.test(c)).sort();
      const ok = codes.find((c) => c.startsWith("2"));
      const assertions: ApiRequest["assertions"] = ok ? [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: ok }] : [];
      // A response schema becomes a schema check (off by default: real data is often looser than the spec).
      if (ok && isV3) {
        const resp = resolveLocal(doc, (op.responses as Json)[ok]);
        const content = isObj(resp?.content) ? (resp!.content as Json) : {};
        const ct = Object.keys(content).find((c) => c.includes("json"));
        const schema = ct && isObj(content[ct]) ? (content[ct] as Json).schema : undefined;
        if (schema) {
          const inlined = inlineRefs(doc, schema, 0);
          const text = JSON.stringify(inlined);
          if (text.length < 16_000) assertions.push({ id: apiId("a"), enabled: false, source: "json", path: "$", op: "schema", value: text });
        }
      }
      const path = rawPath.replace(/\{([^}]+)\}/g, "{{$1}}");
      requests.push(
        newApiRequest({
          name: str(op.summary ?? op.operationId, `${m.toUpperCase()} ${rawPath}`).slice(0, 120) || `${m.toUpperCase()} ${rawPath}`,
          method: asMethod(m),
          url: `{{baseUrl}}${path}`,
          params,
          headers,
          body,
          assertions,
          folderId: folderFor(Array.isArray(op.tags) ? str(op.tags[0]) : undefined),
          description: str(op.description).slice(0, 2000),
          auth: op.security && Array.isArray(op.security) && op.security.length === 0 ? { type: "none" } : { type: "inherit" },
        }),
      );
    }
  }
  for (const name of pathVars) if (!variables.some((v) => v.key === name)) variables.push({ key: name, value: "1", enabled: true });
  if (!requests.length) warnings.push("The document has no operations");
  return { format: "openapi", collection: { name: str(info.title, "Imported API").slice(0, 80), description: str(info.description).slice(0, 2000), auth, variables, folders, requests }, environments: [], warnings };
}

function inlineRefs(spec: Json, node: unknown, depth: number): unknown {
  if (depth > 12) return {};
  if (Array.isArray(node)) return node.map((n) => inlineRefs(spec, n, depth + 1));
  if (!isObj(node)) return node;
  if (typeof node.$ref === "string") return inlineRefs(spec, resolveLocal(spec, node) ?? {}, depth + 1);
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) if (!["example", "examples", "description", "xml", "externalDocs"].includes(k)) out[k] = inlineRefs(spec, v, depth + 1);
  return out;
}

// ── HAR ──────────────────────────────────────────────────────────────────────

function importHarCollection(doc: Json): ImportedCollection {
  const log = isObj(doc.log) ? doc.log : {};
  const requests: ApiRequest[] = [];
  const warnings: string[] = [];
  for (const e of (Array.isArray(log.entries) ? log.entries : []).filter(isObj).slice(0, 500)) {
    const req = isObj(e.request) ? e.request : {};
    const res = isObj(e.response) ? e.response : {};
    const { url, params } = splitQuery(str(req.url));
    if (!url) continue;
    const headers = postmanKv((Array.isArray(req.headers) ? req.headers : []).filter(isObj).filter((h) => !str(h.name).startsWith(":") && !["host", "content-length", "connection", "accept-encoding"].includes(str(h.name).toLowerCase())).map((h) => ({ key: h.name, value: h.value })));
    let body: ApiBody = { type: "none" };
    const post = isObj(req.postData) ? req.postData : null;
    if (post) {
      const mime = str(post.mimeType);
      if (mime.includes("json")) body = { type: "json", text: prettyJson(str(post.text)) };
      else if (mime.includes("x-www-form-urlencoded") && Array.isArray(post.params)) body = { type: "form", fields: post.params.filter(isObj).map((p) => ({ key: str(p.name), value: str(p.value), enabled: true })) };
      else body = { type: "raw", text: str(post.text), contentType: mime || "text/plain" };
      const ct = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
      if (ct !== -1 && body.type !== "raw") headers.splice(ct, 1);
    }
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* keep */
    }
    const status = Number(res.status);
    requests.push(newApiRequest({ name: `${asMethod(req.method)} ${pathname}`.slice(0, 120), method: asMethod(req.method), url, params, headers, body, auth: { type: "none" }, assertions: status >= 100 && status <= 599 ? [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: String(status) }] : [] }));
  }
  if (!requests.length) warnings.push("The HAR file has no requests");
  if (requests.some((r) => r.headers.some((h) => ["cookie", "authorization"].includes(h.key.toLowerCase())))) warnings.push("Some requests carry cookies or an Authorization header from the recording; check them before sharing the collection");
  return { format: "har", collection: { name: "Recorded requests", description: `Imported from a HAR file (${requests.length} requests)`, auth: { type: "none" }, variables: [], folders: [], requests }, environments: [], warnings };
}

// ── Mock -> collection ───────────────────────────────────────────────────────

/** One request per mock endpoint (and per resource route) with a status check, to test the mock or the real API it stands for. */
export function collectionFromMock(def: MockApiDefinition, meta: { name: string; baseUrl: string }): ApiCollection {
  const folders: ApiFolder[] = [];
  const requests: ApiRequest[] = [];
  const pathToUrl = (p: string) => p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{{$1}}").replace(/\*$/, "");
  const vars = new Set<string>();
  for (const ep of def.endpoints) {
    if (!ep.enabled) continue;
    for (const m of ep.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) vars.add(m[1]);
    const def0 = ep.responses.find((r) => r.isDefault) ?? ep.responses[0];
    const method = ep.method === "ANY" ? "GET" : (ep.method as ApiMethod);
    requests.push(
      newApiRequest({
        name: (ep.name || `${method} ${ep.path}`).slice(0, 120),
        method,
        url: `{{baseUrl}}${pathToUrl(ep.path)}`,
        body: method === "GET" || method === "HEAD" || method === "DELETE" ? { type: "none" } : { type: "json", text: "{}" },
        assertions: def0 ? [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: String(def0.status) }] : [],
      }),
    );
  }
  for (const r of def.resources ?? []) {
    if (!r.enabled) continue;
    const id = apiId("f");
    folders.push({ id, name: r.name.slice(0, 80), parentId: null });
    const sample = r.seed[0] && typeof r.seed[0] === "object" ? Object.fromEntries(Object.entries(r.seed[0]).filter(([k]) => k !== (r.idField ?? "id"))) : { name: "example" };
    const capture = `${r.name.replace(/[^A-Za-z0-9_]/g, "_")}Id`;
    requests.push(
      newApiRequest({ name: `List ${r.name}`, method: "GET", url: `{{baseUrl}}${r.path}`, folderId: id, assertions: [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: "200" }, { id: apiId("a"), enabled: true, source: "json", path: "$", op: "type", value: "array" }] }),
      newApiRequest({
        name: `Create ${r.name}`,
        method: "POST",
        url: `{{baseUrl}}${r.path}`,
        folderId: id,
        body: { type: "json", text: JSON.stringify(sample, null, 2) },
        assertions: [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: "201" }],
        captures: [{ id: apiId("c"), enabled: true, variable: capture, source: "json", path: `$.${r.idField ?? "id"}` }],
      }),
      newApiRequest({ name: `Get the new ${r.name}`, method: "GET", url: `{{baseUrl}}${r.path}/{{${capture}}}`, folderId: id, assertions: [{ id: apiId("a"), enabled: true, source: "status", op: "eq", value: "200" }] }),
      newApiRequest({ name: `Delete the new ${r.name}`, method: "DELETE", url: `{{baseUrl}}${r.path}/{{${capture}}}`, folderId: id, assertions: [{ id: apiId("a"), enabled: true, source: "status", op: "lt", value: "300" }] }),
    );
  }
  const variables: ApiVariable[] = [{ key: "baseUrl", value: meta.baseUrl.replace(/\/$/, ""), enabled: true }];
  for (const v of vars) variables.push({ key: v, value: "1", enabled: true });
  return { name: meta.name.slice(0, 80), description: `Tests for the mock API ${meta.name}`, auth: { type: "none" }, variables, folders, requests };
}

// ── Detect and import ────────────────────────────────────────────────────────

export type CollectionImportFormat = "vhyxvoid" | "postman" | "openapi" | "har" | "curl";

export interface ImportedCollection {
  format: CollectionImportFormat;
  collection: ApiCollection;
  environments: { name: string; variables: ApiVariable[] }[];
  warnings: string[];
}

export function detectCollectionFormat(doc: unknown): CollectionImportFormat | null {
  if (typeof doc === "string") return /^\s*curl(\.exe)?\s/i.test(doc) ? "curl" : null;
  if (!isObj(doc)) return null;
  if (doc.vhyxvoid === "collection" && isObj(doc.collection)) return "vhyxvoid";
  if (isObj(doc.info) && Array.isArray(doc.item)) return "postman";
  if ((typeof doc.openapi === "string" && doc.openapi.startsWith("3")) || doc.swagger === "2.0") return "openapi";
  if (isObj(doc.log) && Array.isArray(doc.log.entries)) return "har";
  return null;
}

function normalizeRequest(r: Json): ApiRequest {
  const base = newApiRequest();
  return {
    ...base,
    ...(r as Partial<ApiRequest>),
    id: str(r.id) || base.id,
    params: Array.isArray(r.params) ? (r.params as ApiKeyValue[]) : [],
    headers: Array.isArray(r.headers) ? (r.headers as ApiKeyValue[]) : [],
    assertions: Array.isArray(r.assertions) ? (r.assertions as ApiRequest["assertions"]) : [],
    captures: Array.isArray(r.captures) ? (r.captures as ApiRequest["captures"]) : [],
    auth: isObj(r.auth) ? (r.auth as ApiAuth) : { type: "inherit" },
    body: isObj(r.body) ? (r.body as ApiBody) : { type: "none" },
    folderId: typeof r.folderId === "string" ? r.folderId : null,
  };
}

/** Any supported document (object, or a curl command string); throws a readable Error otherwise. */
export function importApiCollection(doc: unknown): ImportedCollection {
  switch (detectCollectionFormat(doc)) {
    case "vhyxvoid": {
      const file = doc as Json;
      const c = file.collection as Json;
      return {
        format: "vhyxvoid",
        collection: {
          name: str(c.name, "Collection").slice(0, 80),
          description: str(c.description).slice(0, 2000),
          auth: isObj(c.auth) ? (c.auth as ApiAuth) : { type: "none" },
          variables: Array.isArray(c.variables) ? (c.variables as ApiVariable[]) : [],
          folders: Array.isArray(c.folders) ? (c.folders as ApiFolder[]) : [],
          requests: (Array.isArray(c.requests) ? c.requests : []).filter(isObj).map(normalizeRequest),
        },
        environments: (Array.isArray(file.environments) ? file.environments : []).filter(isObj).map((e) => ({ name: str(e.name, "Environment").slice(0, 80), variables: Array.isArray(e.variables) ? (e.variables as ApiVariable[]) : [] })),
        warnings: [],
      };
    }
    case "postman":
      return importPostmanCollection(doc as Json);
    case "openapi":
      return importOpenApiCollection(doc as Json);
    case "har":
      return importHarCollection(doc as Json);
    case "curl": {
      const { request, warnings } = parseCurl(doc as string);
      return { format: "curl", collection: { name: request.name.slice(0, 80), description: "", auth: { type: "none" }, variables: [], folders: [], requests: [request] }, environments: [], warnings };
    }
    default:
      throw new Error("Not a supported document. Use a VhyxVoid collection, a Postman collection (v2.x), OpenAPI 3 / Swagger 2, a HAR file, or a curl command.");
  }
}
