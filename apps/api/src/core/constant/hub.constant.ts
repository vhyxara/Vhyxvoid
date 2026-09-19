export const allowedOrigins = [
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
];

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
