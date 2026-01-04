import { FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '@/config/logger';
import { env } from '@/config/env';
import { ApiError } from '@/errors/api-error';

export const errorHandler = (err: any, req: FastifyRequest, res: FastifyReply) => {
  const status = err instanceof ApiError ? err.statusCode : 500;
  const message = err.message || 'Something went wrong';

  logger.error(err);

  res.status(status).send({
    ok: false,
    status: 'error',
    message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFoundHandler = (req: FastifyRequest, res: FastifyReply) => {
  res.status(404).send({ ok: false, message: `Route ${req.originalUrl} not found.` });
};
