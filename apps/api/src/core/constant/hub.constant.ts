export const allowedOrigins = [
  'http://localhost:4000',
  'http://192.168.1.111:4000',
  'https://vigilant-space-fortnight-6x4qp6r479q2r4xx-9000.app.github.dev',
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
