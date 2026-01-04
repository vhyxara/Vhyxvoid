// import { HealthService } from '@/services/health.service.ts';
// import { successResponse } from '@/utils/response.ts';
import { FastifyReply, FastifyRequest } from 'fastify';
import { HealthService } from 'src/services/health.service';
import { successResponse } from 'src/utils/response';

export const HealthController = {
  status(req: FastifyRequest, res: FastifyReply) {
    const result = HealthService.checkStatus();
    return successResponse(res, result);
  },

  health(req: FastifyRequest, res: FastifyReply) {
    const result = HealthService.checkHealth();
    return successResponse(res, result);
  },

  err(req: FastifyRequest, res: FastifyReply) {
    HealthService.throwError();
  },

  uptime(req: FastifyRequest, res: FastifyReply) {
    const result = HealthService.getUptime();
    return successResponse(res, result);
  },
};
