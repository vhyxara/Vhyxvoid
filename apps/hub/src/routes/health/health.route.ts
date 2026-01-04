import fastify from 'fastify';
import { HealthController } from '@/controllers/health/health.controller.js';

const router = fastify();

router.get('/', HealthController.status);
router.get('/health', HealthController.health);
router.get('/err', HealthController.err);
router.get('/uptime', HealthController.uptime);

export default router;
