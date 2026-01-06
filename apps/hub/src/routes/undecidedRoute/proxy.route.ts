import Fastify from 'fastify';
import { proxyController } from '@/controllers/gateController/proxy.controller';
const fastify = Fastify();
fastify.post('/hub', proxyController);
export default fastify;
