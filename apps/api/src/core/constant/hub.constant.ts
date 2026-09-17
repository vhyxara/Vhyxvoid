export const allowedOrigins = [
  "http://localhost:4000",
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
