import bcrypt from "bcryptjs";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
// import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { getRedis } from "@/core/redis/RedisClient";
import {
  CLOCK_SKEW_MS,
  REFRESH_COOKIE_NAME,
  SIGNATURE_TTL_MS,
  TTL,
} from "@/core/constant/ttl.constant";

export const hashPassword = async (password: string) => {
  return await bcrypt.hash(password, 10);
};

export const comparePassword = async (password: string, hash: string) => {
  return await bcrypt.compare(password, hash);
};

// export const signToken = async (app: FastifyInstance, payload: object): Promise<string> => {
//   const secret = process.env.JWT_SECRET as string;
//   if (!secret) {
//     throw new Error('JWT_SECRET environment variable is missing.');
//   }
//   const expiresIn: string | number = process.env.JWT_EXPIRES_IN || ('1d' as const);
//   if (!expiresIn) {
//     throw new Error('JWT_EXPIRES_IN environment variable is missing.');
//   }

//   // const jwtsign = jwt.sign(payload, secret, {
//   //   expiresIn: process.env.JWT_EXPIRES_IN || '1d',
//   // });
//   return await app.jwt.sign(payload);
// };
// export const generateToken = async (
//   app: FastifyInstance,
//   userId: string,
//   role: string,
// ): Promise<string> => {
//   const secret = process.env.JWT_SECRET as string;

//   if (!secret) {
//     throw new Error('JWT_SECRET environment variable is missing.');
//   }

//   const payload = { id: userId, role };
//   return await app.jwt.sign(payload);
// };

export const verifyToken = async (
  app: FastifyInstance,
  token: string,
): Promise<any> => {
  try {
    return await app.jwt.verify(token);
  } catch (err) {
    throw new Error("Invalid or expired token");
  }
};
// export const isAuthenticatedUser = (user: any): user is JwtPayload => {
//   return user && typeof user === 'object' && user !== null;
// };

export function requireAbility(ability: string) {
  return (req: FastifyRequest, res: FastifyReply, next: Function) => {
    const user = req.user;
    if (!user) {
      return res.status(401).send({ error: "Unauthorized" });
    }
    const abilities = user?.abilities || [];
    if (user?.roles?.includes("superadmin")) {
      return next();
    }

    if (abilities.includes("superadmin") || abilities.includes(ability)) {
      return next();
    }

    return res.status(403).send({ error: "Forbidden" });
  };
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true, // JS cannot read this — XSS-proof
    secure: process.env.NODE_ENV === "production", // HTTPS only in prod
    sameSite: "strict", // CSRF protection
    path: "/api/v1/auth", // Cookie only sent to auth endpoints — minimises exposure
    maxAge: TTL.REFRESH_TOKEN_MS / 1000, // seconds
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: "/api/v1/auth",
  });
}

export function getRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE_NAME];
}

/* -------------------- TYPES -------------------- */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ClientSecrets = Record<string, string | undefined>;

/* -------------------- CANONICALIZATION -------------------- */

function normalizePayload(payload: JsonValue): JsonValue {
  if (Array.isArray(payload)) {
    return payload.map(normalizePayload);
  }

  if (payload && typeof payload === "object") {
    return Object.keys(payload)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        acc[key] = normalizePayload(
          (payload as Record<string, JsonValue>)[key],
        );
        return acc;
      }, {});
  }

  return payload;
}

/* -------------------- CONSTANT-TIME COMPARE -------------------- */

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");

  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* -------------------- CLIENT SECRET LOOKUP -------------------- */

async function getClientSecret(apiKey: string): Promise<string | undefined> {
  // Example: DB / Secrets Manager / Env-based lookup
  const clients: ClientSecrets = {
    client_123: process.env.CLIENT_123_SECRET,
  };

  return clients[apiKey];
}

/* -------------------- MIDDLEWARE -------------------- */

export async function signatureVerification(
  req: FastifyRequest,
  res: FastifyReply,
  next: Function,
): Promise<void> {
  // const apiKey = process.env.apiKey;

  try {
    const {
      "x-api-key": apiKey,
      "x-signature": signature,
      "x-nonce": nonce,
      "x-timestamp": timestamp,
    } = req.headers;

    if (
      typeof apiKey !== "string" ||
      typeof signature !== "string" ||
      typeof nonce !== "string" ||
      typeof timestamp !== "string"
    ) {
      res.status(400).send({ error: "Missing authentication headers" });
      return;
    }

    /* ---- REQUIRED HEADERS ---- */
    if (!apiKey || !signature || !nonce || !timestamp) {
      res.status(400).send({ error: "Missing authentication headers" });
      return;
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      res.status(400).send({ error: "Invalid timestamp" });
      return;
    }

    const now = Date.now();

    /* ---- TIMESTAMP VALIDATION ---- */
    if (Math.abs(now - ts) > SIGNATURE_TTL_MS + CLOCK_SKEW_MS) {
      res.status(403).send({ error: "Request expired or too far in future" });
      return;
    }

    const redis = getRedis();

    if (!redis) {
      throw new Error("Redis client is not initialized");
    }
    /* ---- NONCE REPLAY PROTECTION ---- */
    const nonceKey = `nonce:${apiKey}:${nonce}`;
    const exists = await redis.get(nonceKey);

    if (exists) {
      res.status(403).send({ error: "Replay attack detected" });
      return;
    }

    await redis.set(nonceKey, "1", {
      px: SIGNATURE_TTL_MS,
    });

    /* ---- CLIENT SECRET ---- */
    const secret = await getClientSecret(apiKey);
    if (!secret) {
      res.status(403).send({ error: "Invalid API key" });
      return;
    }

    /* ---- CANONICAL PAYLOAD ---- */
    const normalizedBody = normalizePayload((req.body ?? {}) as JsonValue);

    const bodyString = JSON.stringify(normalizedBody);

    const signingString = [bodyString, nonce, timestamp, apiKey].join("|");

    /* ---- SIGNATURE CALCULATION ---- */
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signingString)
      .digest("hex");

    /* ---- CONSTANT-TIME VALIDATION ---- */
    if (!safeCompare(expectedSignature, signature)) {
      res.status(403).send({ error: "Invalid signature" });
      return;
    }

    /* ---- SUCCESS ---- */
    next();
  } catch (err) {
    console.error("Signature verification failed:", err);
    res.status(500).send({ error: "Internal authentication error" });
  }
}

export default signatureVerification;
