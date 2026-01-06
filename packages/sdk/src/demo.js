// import { HubClient } from "./blackserver-client";
// const client = new HubClient({
//   hubUrl: process.env.HUB_URL || "ws://localhost:9000/ws",
//   apiKey: "front-demo",
// });
// client.connect();

// setTimeout(async () => {
//   try {
//     const res = await client.fetch("/hello", { method: "GET" });
//     const bodyBase64 = res.body || "";
//     const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
//     console.log("response", res.status, body);
//     process.exit(0);
//   } catch (e) {
//     console.error("fetch failed", e);
//     process.exit(1);
//   }
// }, 800);
import { HubClient } from "./blackserver-client.js";

const client = new HubClient({
  hubUrl: process.env.HUB_URL || "ws://localhost:9000/ws",
  apiKey: "front-demo",
});
client.connect();

client.ws.onopen = () => {
  console.log("WebSocket connection established.");
};

client.ws.onclose = () => {
  console.log("WebSocket connection closed.");
};

client.ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};
setTimeout(async () => {
  try {
    const res = await client.fetch("/hello", { method: "GET" });
    const bodyBase64 = res.body || "";
    const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
    console.log("response", res.status, body);
    process.exit(0);
  } catch (e) {
    console.error("fetch failed", e);
    process.exit(1);
  }
}, 800);
