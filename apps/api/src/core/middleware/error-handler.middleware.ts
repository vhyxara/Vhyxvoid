import { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "@/core/errors/app-error";
import { ZodError } from "zod";
import { NotFoundError } from "@/core/errors/error.format";

export const notFoundHandler = (req: FastifyRequest, reply: FastifyReply) => {
  throw new NotFoundError(`Route ${req.method} ${req.url} not found`);
};

export const requestIdHook = (
  req: FastifyRequest,
  res: FastifyReply,
  done: () => void,
) => {
  req.id = req.id || crypto.randomUUID();
  done();
};

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "TOO_MANY_REQUESTS",
};

const clientErrorStatus = (error: unknown): number | undefined => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return error instanceof Error &&
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500
    ? status
    : undefined;
};

export const errorHandler = (
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const requestId = request.id;

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      message: error.message,
      code: error.code,
      data: null,
      requestId,
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Invalid request data",
      data: null,
      errors: error.issues.map((e) => ({ path: e.path, message: e.message })),
      requestId,
    });
  }

  // Fastify's own client errors (invalid JSON body, oversized body, unsupported
  // media type, ...) are plain Errors carrying a 4xx statusCode. They are the
  // caller's fault, so answer with that status instead of the 500 fallback.
  const clientStatus = clientErrorStatus(error);
  if (clientStatus !== undefined) {
    return reply.status(clientStatus).send({
      success: false,
      code: CLIENT_ERROR_CODES[clientStatus] ?? "BAD_REQUEST",
      message: (error as Error).message,
      data: null,
      requestId,
    });
  }

  request.log.error(
    {
      requestId,
      err: error,
      path: request.url,
      method: request.method,
    },
    "Unhandled Exception",
  );

  // request.log.error above is a silent no-op unless Fastify's logger is
  // enabled (server.ts builds Fastify() with no logger option, so its
  // default logger has no real transport) — this left every unhandled
  // exception in this app completely invisible in server output. Falling
  // back to console.error guarantees the actual error is always visible
  // regardless of logger config. See internal-tools/api/decision.md, 2026-09-12 (Bug 2 investigation).
  console.error(`[Unhandled Exception] ${request.method} ${request.url} (requestId=${requestId})`, error);

  // 4 Fallback: Internal Server Error (500)
  return reply.status(500).send({
    success: false,
    code: "INTERNAL_ERROR",
    message:
      "An unexpected error occurred. Please contact support with the Request ID.",
    error: process.env.NODE_ENV === "development" ? String(error) : undefined,
    data: null,
    requestId,
  });
};
