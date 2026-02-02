import { FastifyReply } from 'fastify';

export const successResponse = (
  res: FastifyReply,
  message: string = 'Success',
  statusCode: number = 200,
  data?: unknown,
) => {
  return res.status(statusCode).send({ success: true, message, data });
};

export const errorResponse = (res: FastifyReply, error: unknown, status = 500) => {
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).send({ success: false, message });
};
