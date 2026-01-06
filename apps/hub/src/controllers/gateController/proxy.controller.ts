// import { routeRequestToAgent } from '@/core/ws';
import { FastifyReply, FastifyRequest } from 'fastify';
import { routeRequestToAgent } from '@/core/ws';

export const proxyController = async (req: FastifyRequest, res: FastifyReply) => {
  const payload: any = req.body as any;
  try {
    const agentId = payload.agentId; // optional
    const result = await routeRequestToAgent(agentId, {
      method: payload.method || 'GET',
      path: payload.path || '/',
      headers: payload.headers || {},
      body: payload.body ?? null,
    });

    // result.body is base64
    const buf = result.body ? Buffer.from(result.body, 'base64') : Buffer.from('');
    // try to parse JSON
    let parsed: any = buf.toString();
    try {
      parsed = JSON.parse(parsed);
    } catch {
      /* keep string */
    }

    return res.code(Number(result.status || 200)).send(parsed);
  } catch (err: any) {
    return res.code(502).send({ error: err.message || 'agent_error' });
  }
};
