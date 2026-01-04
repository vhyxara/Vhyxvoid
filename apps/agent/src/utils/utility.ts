import axios from "axios";
import { pushToDurableQueue } from "./queue";

export async function forwardToLocalBackend(msg: any) {
  const host = process.env.BACKEND_HOST || "localhost";
  const port = process.env.BACKEND_PORT || "5050";
  const url = `http://${host}:${port}${msg.path || "/"}`;

  const data = msg.isBase64
    ? Buffer.from(msg.body, "base64")
    : msg.body ?? undefined;

  const r = await axios.request({
    url,
    method: msg.method || "GET",
    headers: msg.headers || {},
    data,
    timeout: 15000,
    responseType: "arraybuffer",
  });

  return {
    status: r.status,
    headers: r.headers,
    body: Buffer.from(r.data).toString("base64"),
  };
}

/**
 * Accepts msg: { requestId, method, path, headers, body }
 * Returns: { status, headers, body } where body is base64 string
 */
export async function handleRequestMessage(msg: any) {
  const host = process.env.BACKEND_HOST || "localhost";
  const port = process.env.BACKEND_PORT || "5050";
  const url = `http://${host}:${port}${msg.path || "/"}`;

  // If client sent body as object or base64, support both
  let data: any = undefined;
  if (msg.body != null) {
    if (msg.isBase64) {
      data = Buffer.from(msg.body, "base64");
    } else {
      data = msg.body;
    }
  }

  try {
    const r = await axios.request({
      url,
      method: (msg.method || "GET") as any,
      headers: msg.headers || {},
      data,
      timeout: 15000,
      responseType: "arraybuffer",
    });

    const headers: Record<string, string> = {};
    for (const k in r.headers) headers[k] = String((r.headers as any)[k]);

    const bodyBase64 = Buffer.from(r.data).toString("base64");
    return { status: r.status, headers, body: bodyBase64 };
  } catch (err: any) {
    try {
      pushToDurableQueue({ msg, ts: Date.now() });
      console.log("[agent] backend forward failed — queued");
      // let frontend know we queued it (status 202)
      return {
        status: 202,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("queued").toString("base64"),
      };
    } catch (qerr) {
      console.error("[agent] queue push failed", qerr);
      return {
        status: 502,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(String(err?.message || "error")).toString("base64"),
      };
    }
  }
}
