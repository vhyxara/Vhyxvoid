// import express from "express";
// import helmet from "helmet";
// import cors from "cors";
// import compression from "compression";
// import { rateLimiter } from "../src/middlewares/rate-limit.middleware";
// import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
// import routes from "./routes";
// // import { logger } from "./config/logger";

// const app = express();

// // Logging
// // app.use(pinoHttp({ logger }));

// // Security
// app.use(helmet());
// app.use(cors());

// // Enable gzip compression for responses to reduce payload size and improve performance
// app.use(compression());

// // Body parsers
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Rate limiter
// app.use(rateLimiter);

// // routes
// app.use("/api/v1", routes);

// // // 404 + error handling
// app.use(notFoundHandler);
// app.use(errorHandler);

// export default app;
