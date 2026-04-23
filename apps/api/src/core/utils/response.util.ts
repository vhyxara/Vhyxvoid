import { FastifyReply } from "fastify";

export const successResponse = (
  res: FastifyReply,
  message: string = "Success",
  statusCode: number = 200,
  data?: unknown,
) => {
  return res.status(statusCode).send({ success: true, message, data });
};

export const errorResponse = (
  res: FastifyReply,
  error: unknown,
  status = 500,
) => {
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).send({ success: false, message });
};

export const tableResponse = <T, TExtra = unknown>(
  res: FastifyReply,
  {
    items,
    page,
    limit,
    total,
    extra,
  }: {
    items: T[];
    page: number;
    limit: number;
    total: number;
    extra?: TExtra;
  },
  message = "Success",
) => {
  const totalPages = Math.ceil(total / limit);

  return res.status(200).send({
    success: true,
    message,
    items,
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    ...(extra !== undefined && { extra }),
  });
};
