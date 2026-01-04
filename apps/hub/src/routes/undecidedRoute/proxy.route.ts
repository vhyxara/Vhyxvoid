import Fastify from 'fastify';
import { proxyController } from '@/controllers/gateController/proxy.controller';
const fastify = Fastify();
fastify.post('/bridge', proxyController);
export default fastify;
