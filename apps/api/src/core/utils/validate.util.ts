import { ZodSchema } from 'zod';
import { FastifyReply } from 'fastify';

export function validate<T>(schema: ZodSchema<T>, data: unknown, res: FastifyReply): T | null {
  const result = schema.safeParse(data);

  if (!result.success) {
    res.status(400).send({
      success: false,
      message: 'validation failed',
      errors: result.error.flatten(),
    });
    return null;
  }

  return result.data;
}
