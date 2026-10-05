// Browser origins allowed to call the API with credentials: the local dev
// ports below, plus APP_URL (dashboard), ADMIN_URL (admin panel) and any
// comma-separated CORS_ORIGINS from the environment.
const fromEnv = [process.env.APP_URL, process.env.ADMIN_URL, ...(process.env.CORS_ORIGINS ?? "").split(",")]
  .map((v) => v?.trim())
  .filter((v): v is string => Boolean(v))
  .map((v) => {
    try {
      return new URL(v).origin;
    } catch {
      return "";
    }
  })
  .filter(Boolean);

export const allowedOrigins = [
  ...new Set([
  ...fromEnv,
  "http://localhost:4000",
  // Port 4177 is this monorepo's established fallback dev port for apps/web
  // (see internal-tools/user-frontend/decision.md and
  // internal-tools/shared/LOCAL_DEV_BACKEND.md) — port 4000 is frequently
  // occupied by an unrelated local project. Needed for local functional
  // testing against this API; safe to remove if that convention changes.
  "http://localhost:4177",
  // apps/admin's local dev port — see internal-tools/admin-frontend/decision.md,
  // 2026-09-17 (scaffolding session), "Location, naming, port".
  "http://localhost:4001",
  "https://www.vhyxvoid.com",
  "https://vhyxvoid.com",
  "https://admin.vhyxvoid.com",
  ]),
];

/** Whether a URL points at one of our own browser origins (checkout/portal return URLs). */
export function isOwnOrigin(url: string): boolean {
  try {
    return allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

// await server.register(fastifyCors, {
//   origin: (origin, cb) => {
//     // Allow server-to-server or curl requests
//     if (!origin) {
//       cb(null, true);
//       return;
//     }

//     if (allowedOrigins.includes(origin)) {
//       cb(null, true);
//     } else {
//       // IMPORTANT: do NOT throw an error
//       cb(null, false);
//     }
//   },
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"],
// });
