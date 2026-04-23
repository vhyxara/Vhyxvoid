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

  request.log.error(
    {
      requestId,
      err: error,
      path: request.url,
      method: request.method,
    },
    "Unhandled Exception",
  );

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
