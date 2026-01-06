// simple JS WS client that mirrors fetch semantics (Node demo)
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { buildSignature } from "./sign";

// export class HubClient {
//   constructor({ hubUrl, apiKey }) {
//     this.hubUrl = hubUrl;
//     this.apiKey = apiKey;
//     this.ws = null;
//     this.pending = new Map();
//   }

//   connect() {
//     this.ws = new WebSocket(this.hubUrl);
//     this.ws.on("open", () => {
//       this.ws.send(
//         JSON.stringify({
//           type: "register_frontend",
//           frontendId: "frontend-demo",
//           apiKey: this.apiKey,
//         })
//       );
//     });

//     this.ws.on("message", (data) => {
//       try {
//         const msg = JSON.parse(data.toString());
//         if (msg.type === "response" && msg.requestId) {
//           const p = this.pending.get(msg.requestId);
//           if (p) {
//             this.pending.delete(msg.requestId);
//             p.resolve(msg);
//           }
//         }
//       } catch (e) {
//         console.error("parse err", e);
//       }
//     });

//     this.ws.on("close", () => setTimeout(() => this.connect(), 1000));
//     this.ws.on("error", (e) => console.error("ws error", e));
//   }
//  async fetch(path, opts = {}) {
//     if (!this.ws) this.connect();
//     const id = randomUUID();
//     const payload = {
//       type: "request",
//       requestId: id,
//       path,
//       method: opts.method || "GET",
//       headers: opts.headers || {},
//       body: opts.body ?? null,
//     };
//     return new Promise((resolve, reject) => {
//       this.pending.set(id, { resolve, reject });
//       this.ws.send(JSON.stringify(payload));
//       setTimeout(() => {
//         if (this.pending.has(id)) {
//           this.pending.delete(id);
//           reject(new Error("timeout"));
//         }
//       }, 15000);
//     });
//   }
// }

export class HubClient {
  private ws?: WebSocket;
  private pending = new Map<
    string,
    { resolve: Function; reject: Function; timeout: NodeJS.Timeout }
  >();
  constructor(
    private opts: {
      hubUrl: string;
      apiKey: string;
      apiSecret: string;
      timeoutMs?: number;
    }
  ) {}
  retries = 5; // Max retries
  retryInterval = 2000; // Retry interval (2 seconds)

  // constructor(opts) {
  //   this.opts = opts;
  //   this.connect();
  // }

  async connect(retryCount = 0) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.opts.hubUrl);

    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", resolve);
      this.ws!.once("error", reject);
    });
    this.ws.onopen = () => {
      console.log("WebSocket connected");
      this.sendFrontendRegisterMessage();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data.toString());
        console.log("Received message:", msg);

        if (msg.type === "response" && msg.requestId) {
          const pendingRequest = this.pending.get(msg.requestId);
          if (!pendingRequest) {
            return console.error(
              `No pending request found for requestId: ${msg.requestId}`
            );
          }
          if (pendingRequest) {
            const { resolve, reject } = pendingRequest;

            // Ensure resolve is a function
            if (typeof resolve === "function") {
              this.pending.delete(msg.requestId); // Remove from pending map
              resolve(msg);
            } else {
              console.error(
                `No resolve function for requestId: ${msg.requestId}`
              );
            }
          } else {
            console.error(
              `No pending request found for requestId: ${msg.requestId}`
            );
          }
          clearTimeout(pendingRequest.timeout); // Clear the timeout
          this.pending.delete(msg.requestId); // Remove from pending map
          pendingRequest.resolve(msg);
        }
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    };

    this.ws.onclose = () => {
      if (retryCount < this.retries) {
        console.log(
          `WebSocket disconnected, retrying (${retryCount + 1}/${
            this.retries
          })...`
        );
        setTimeout(() => this.connect(retryCount + 1), this.retryInterval);
      } else {
        console.error("WebSocket failed to connect after multiple retries");
      }
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error", err);
    };
  }

  sendFrontendRegisterMessage() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: "frontend_register", apiKey: this.opts.apiKey })
      );
    } else {
      console.error("WebSocket is not open yet. Message not sent.");
    }
  }

  async fetch(path, opts = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log("WebSocket is not open yet, waiting for connection...");
      await new Promise((resolve) => {
        const checkConnectionInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnectionInterval);
            resolve();
          }
        }, 100); // Check every 100ms until the WebSocket is open
      });
    }

    const id = randomUUID();
    const ts = Date.now();
    const secret = process.env.BRIDGE_SECRET || "default_secret";
    const frontendKey = process.env.FRONTEND_KEY || "default_frontend_key";
    const signature = buildSignature({
      method: opts.method || "GET",
      path,
      body: opts.body ?? null,
      requestId: id,
      ts,
      secret,
    });
    const meta = { frontendKey, ts, signature };
    const payloadWithMeta = { ...opts, requestId: id, meta };
    const payload = {
      type: "request",
      requestId: id,
      path,
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body ?? null,
    };

    return new Promise((resolve, reject) => {
      console.log(`Sending request with id: ${id}`);
      // Store both resolve and reject functions to handle the promise lifecycle
      this.pending.set(id, { resolve, reject });

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payloadWithMeta));
      } else {
        reject(new Error("WebSocket is not open"));
      }

      // Timeout after 15 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timeout"));
        }
      }, 15000); // Timeout after 15 seconds
    });
  }
}

// export interface HubOptions {
//   apiKey: string;
//   hubUrl: string; // wss://hub-url/ws
// }

// export class HubClient {
//   private ws: WebSocket | null = null;
//   private pending = new Map<string, (data: any) => void>();
//   private opts: HubOptions;

//   constructor(opts: HubOptions) {
//     this.opts = opts;
//     this.connect();
//   }

//   public connect() {
//     this.ws = new WebSocket(this.opts.hubUrl);

//     this.ws.onopen = () => {
//       this.ws?.send(
//         JSON.stringify({ type: "frontend_register", apiKey: this.opts.apiKey })
//       );
//     };

//     this.ws.onmessage = (ev) => {
//       try {
//         const msg = JSON.parse(ev.data);
//         if (msg.type === "response" && msg.requestId) {
//           const resolve = this.pending.get(msg.requestId);
//           if (resolve) {
//             this.pending.delete(msg.requestId);
//             resolve(msg);
//           }
//         }
//       } catch {}
//     };

//     this.ws.onclose = () => {
//       setTimeout(() => this.connect(), 2000);
//     };
//   }

//   async fetch(
//     path: string,
//     body?: any,
//     method: "GET" | "POST" = "GET"
//   ): Promise<any> {
//     const id = crypto.randomUUID();

//     const payload = {
//       type: "request",
//       requestId: id,
//       path,
//       method,
//       body: body ?? null,
//     };

//     return new Promise((resolve) => {
//       this.pending.set(id, resolve);
//       this.ws?.send(JSON.stringify(payload));
//       setTimeout(() => {
//         if (this.pending.has(id)) {
//           this.pending.delete(id);
//           resolve({ error: "timeout" });
//         }
//       }, 15000);
//     });
//   }
// }
