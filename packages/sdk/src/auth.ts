// hub/src/auth.ts
// import crypto from 'crypto';
// // import { getFrontendSecret } from './store'; // DB lookup

// export function getFrontendSecret(frontendKey: string): string | null {
//   return FRONTEND_KEYS.get(frontendKey) ?? null;
// }

// export function verifySignature({ method, path, bodyBase64, requestId, ts, signature, frontendKey }: {
//   method: string, path: string, bodyBase64?: string|null, requestId: string, ts: number, signature: string, frontendKey: string
// }) {
//   const secret = getFrontendSecret(frontendKey); // returns secret or throws
//   if (!secret) return false;

//   const body = bodyBase64 ? Buffer.from(bodyBase64, 'base64').toString() : '';
//   const bodyHash = body ? crypto.createHash('sha256').update(body).digest('hex') : '';
//   const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;

//   const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
//   const signatureMatch = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

//   // timestamp window
//   const now = Date.now();
//   if (Math.abs(now - ts) > 60_000) return false; // outside 60s window

//   return signatureMatch;
// }
