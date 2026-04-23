import { env } from "@/core/config/env.config";
import pino from "pino";

const transport =
  env.NODE_ENV === "development"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }
    : undefined;

export const logger = pino(
  { level: env.LOG_LEVEL },
  transport ? pino.transport(transport) : undefined,
);
