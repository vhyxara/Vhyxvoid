// // apps/hub/src/services/HubAuthService.ts
// // Connects Hub to the existing ValidateApiKeyUseCase.
// // No HTTP call — shared code import from packages/shared.

// import { ValidateApiKeyUseCase, SecurityEventType } from '@vhyxvoid/shared';
// import {
//   buildCanonical,
//   verifyCanonical,
//   AgentRegisterMsg,
//   SdkRequestMsg,
//   SdkRegisterMsg,
//   TIMING,
// } from '@vhyxvoid/protocol';

// export interface HubAuthResult {
//   accountId: string;
//   keyId: string;
//   scopes: string[];
//   rateLimitPerMinute: number;
//   accountStatus: string;
// }

// export class HubAuthService {
//   constructor(private readonly validateKeyUseCase: ValidateApiKeyUseCase) {}

//   /**
//    * Authenticate an agent trying to register.
//    * Validates: key exists, ACTIVE, has tunnel:connect scope, timestamp window.
//    * Throws HubAuthError on any failure.
//    */
//   async authenticateAgent(msg: AgentRegisterMsg, ip: string): Promise<HubAuthResult> {
//     this.checkTimestamp(msg.ts);

//     const canonical = buildCanonical({
//       method: 'AGENT_REGISTER',
//       path: '/agent/register',
//       query: '',
//       body: msg.label,
//       requestId: msg.requestId,
//       ts: msg.ts,
//     });

//     const result = await this.validateKeyUseCase.execute({
//       keyId: msg.keyId,
//       signature: msg.signature,
//       method: 'AGENT_REGISTER',
//       path: '/agent/register',
//       body: msg.label,
//       requestId: msg.requestId,
//       timestamp: msg.ts,
//       requiredScope: 'tunnel:connect',
//       ip,
//     });

//     if (!result.valid) {
//       throw new HubAuthError(result.code as any, result.reason);
//     }

//     return {
//       accountId: result.accountId,
//       keyId: msg.keyId,
//       scopes: result.scopes,
//       rateLimitPerMinute: result.rateLimitPerMinute ?? Infinity,
//       accountStatus: 'ACTIVE',
//     };
//   }

//   /**
//    * Authenticate an SDK request message.
//    * Called on EVERY sdk:request — must be fast (Redis cache hit = ~1ms).
//    */
//   async authenticateRequest(msg: SdkRequestMsg, ip: string): Promise<HubAuthResult> {
//     this.checkTimestamp(msg.ts);

//     const result = await this.validateKeyUseCase.execute({
//       keyId: msg.keyId,
//       signature: msg.signature,
//       method: msg.method,
//       path: msg.path,
//       body: msg.body ?? '',
//       requestId: msg.requestId,
//       timestamp: msg.ts,
//       requiredScope: 'tunnel:connect',
//       ip,
//     });

//     if (!result.valid) {
//       throw new HubAuthError(result.code as any, result.reason);
//     }

//     return {
//       accountId: result.accountId,
//       keyId: msg.keyId,
//       scopes: result.scopes,
//       rateLimitPerMinute: result.rateLimitPerMinute ?? Infinity,
//       accountStatus: 'ACTIVE',
//     };
//   }

//   /**
//    * Authenticate an SDK registration (connect handshake).
//    */
//   async authenticateSdkRegister(msg: SdkRegisterMsg, ip: string): Promise<HubAuthResult> {
//     this.checkTimestamp(msg.ts);

//     const result = await this.validateKeyUseCase.execute({
//       keyId: msg.keyId,
//       signature: msg.signature,
//       method: 'SDK_REGISTER',
//       path: '/sdk/register',
//       body: '',
//       requestId: msg.requestId,
//       timestamp: msg.ts,
//       requiredScope: 'tunnel:connect',
//       ip,
//     });

//     if (!result.valid) {
//       throw new HubAuthError(result.code as any, result.reason);
//     }

//     return {
//       accountId: result.accountId,
//       keyId: msg.keyId,
//       scopes: result.scopes,
//       rateLimitPerMinute: result.rateLimitPerMinute ?? Infinity,
//       accountStatus: 'ACTIVE',
//     };
//   }

//   private checkTimestamp(ts: number): void {
//     const delta = Math.abs(Date.now() - ts);
//     if (delta > TIMING.SIGNATURE_WINDOW_MS) {
//       throw new HubAuthError(
//         'AUTH_FAILED',
//         `Request timestamp is outside the ${TIMING.SIGNATURE_WINDOW_MS / 1000}s window`,
//       );
//     }
//   }
// }

// export class HubAuthError extends Error {
//   constructor(
//     public readonly code: string,
//     message: string,
//   ) {
//     super(message);
//     this.name = 'HubAuthError';
//   }
// }

// apps/hub/src/services/HubAuthService.ts
// Authenticates agents and SDK clients by calling ValidateApiKeyUseCase.
// This is the integration point between the hub and the identity module.
// No Prisma. No HTTP. Shared code import — fast path (~1ms Redis cache hit).

import { IValidateApiKeyUseCase, isConnectableAccountStatus } from '@vhyxvoid/shared';
import {
  AgentRegisterMsg,
  SdkRegisterMsg,
  SdkRequestMsg,
  TIMING,
  buildCanonical,
  signCanonical,
  verifyCanonical,
} from '@vhyxvoid/protocol';
import crypto from 'crypto';
import { debugLog } from '@/utils/debug';

/** Held in memory per TunnelClient connection; never persisted or logged. */
export interface SdkCredential {
  rawSecret: string;
  secretHash: string;
}

export interface HubAuthResult {
  accountId: string;
  keyId: string;
  scopes: string[];
  /** Agent handshake only: which stored secret matched (see AgentSession.secretFingerprint). */
  secretFingerprint?: string;
}

/**
 * Short, non-reversible identifier for a stored secret hash, so a live agent
 * session can remember which secret it authenticated with without keeping
 * the hash itself.
 */
export function secretFingerprint(secretHashHex: string): string {
  return crypto.createHash('sha256').update(secretHashHex).digest('hex').slice(0, 16);
}

export class HubAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HubAuthError';
  }
}

export class HubAuthService {
  constructor(
    private readonly validateKeyUseCase: IValidateApiKeyUseCase,
    private readonly pepper: string, // ← ADD
    private readonly loadKeyHash: (keyId: string) => Promise<{
      // ← ADD
      secretHash: string;
      accountId: string;
      scopes: string[];
      status: string;
      accountStatus: string;
      // Unix ms or null. Honoured at the handshake since audit H3: an expired
      // key used to register until ExpireApiKeysWorker marked it EXPIRED, and
      // the rotation grace window didn't exist for agents.
      expiresAt?: number | null;
      previousSecretHash?: string | null;
      rotationGraceEndsAt?: number | null;
    } | null>,
  ) {}

  /**
   * Authenticate an agent trying to register.
   * Called once per agent connection — on agent:register message.
   */
  async authenticateAgent(msg: AgentRegisterMsg, _ip: string): Promise<HubAuthResult> {
    // No timestamp check needed — this is a connection handshake not a request
    debugLog('[hub-auth] received agent register', { keyId: msg.keyId, label: msg.label });
    const { key, matchedHash } = await this.verifyRawSecret(msg.keyId, msg.rawSecret);
    return {
      accountId: key.accountId,
      keyId: msg.keyId,
      scopes: key.scopes,
      secretFingerprint: secretFingerprint(matchedHash),
    };
  }

  /**
   * A connection handshake that carries the key's raw secret (agents always;
   * TunnelClient since 2026-09-25). Checks key status, account status,
   * expiry, the secret (current, or previous during a rotation's grace
   * window) and the tunnel:connect scope. The raw secret travels only over
   * the TLS WebSocket and is never stored or logged.
   */
  private async verifyRawSecret(keyId: string, rawSecret: string) {
    // Load key from cache/DB
    const key = await this.loadKeyHash(keyId);
    if (!key) {
      throw new HubAuthError('AUTH_FAILED', 'API key not found');
    }

    if (key.status !== 'ACTIVE') {
      throw new HubAuthError('AUTH_FAILED', 'API key is not active');
    }

    // PAST_DUE is deliberately allowed (the seven-day grace period is meant
    // to keep service running, not just plan limits) — CONNECTABLE_ACCOUNT_STATUSES
    // is the one shared definition apps/hub's sweep also checks against, so
    // the two can never disagree about what "connectable" means. See
    // shared/decision.md, 2026-09-22, "S4".
    if (!isConnectableAccountStatus(key.accountStatus)) {
      throw new HubAuthError('AUTH_FAILED', 'Account is not active');
    }

    // An expired key is refused here, not only once ExpireApiKeysWorker has
    // marked it EXPIRED (up to its interval later).
    if (key.expiresAt != null && key.expiresAt <= Date.now()) {
      throw new HubAuthError('AUTH_FAILED', 'API key has expired');
    }

    // Verify raw secret — hub applies pepper server-side
    // Never log expectedHash/storedHash/pepper length here, even behind a
    // debug flag — these are secret-adjacent values. See context.md risk #8.
    // During a rotation's grace window the previous secret is accepted too,
    // as the SDK path already did, so an agent restarted with the old secret
    // keeps working until the window ends (then the sweep evicts it).
    const computedHash = Buffer.from(
      crypto.createHmac('sha256', this.pepper).update(rawSecret).digest('hex'),
      'hex',
    );
    const matches = (storedHex: string | null | undefined): boolean => {
      if (!storedHex) return false;
      const stored = Buffer.from(storedHex, 'hex');
      return stored.length === computedHash.length && crypto.timingSafeEqual(stored, computedHash);
    };
    const graceActive =
      key.rotationGraceEndsAt != null && key.rotationGraceEndsAt > Date.now();

    let matchedHash: string;
    if (matches(key.secretHash)) {
      matchedHash = key.secretHash;
    } else if (graceActive && key.previousSecretHash && matches(key.previousSecretHash)) {
      matchedHash = key.previousSecretHash;
    } else {
      throw new HubAuthError('INVALID_SIGNATURE', 'HMAC signature verification failed');
    }

    // Check scope
    const hasScope = key.scopes.includes('*') || key.scopes.includes('tunnel:connect');
    if (!hasScope) {
      throw new HubAuthError('SCOPE_MISSING', 'Key missing tunnel:connect scope');
    }

    return { key, matchedHash };
  }

  /**
   * Authenticate an SDK registration handshake.
   * Called once per SDK connection — on sdk:register message.
   */
  async authenticateSdkRegister(
    msg: SdkRegisterMsg,
    ip: string,
  ): Promise<HubAuthResult & { sdkCredential?: SdkCredential }> {
    this.checkTimestamp(msg.ts);

    // Since 2026-09-25 TunnelClient sends its raw secret once, like an agent.
    // The hub keeps it (and the stored hash it matched) in memory for this
    // connection only, to check each sdk:request's signature. The old
    // signature-only handshake can never succeed (the client can't compute
    // the peppered hash), but is kept so an old client gets a clear error.
    if (msg.rawSecret) {
      const { key, matchedHash } = await this.verifyRawSecret(msg.keyId, msg.rawSecret);
      return {
        accountId: key.accountId,
        keyId: msg.keyId,
        scopes: key.scopes,
        secretFingerprint: secretFingerprint(matchedHash),
        sdkCredential: { rawSecret: msg.rawSecret, secretHash: matchedHash },
      };
    }

    const result = await this.validateKeyUseCase.execute({
      keyId: msg.keyId,
      signature: msg.signature,
      method: 'SDK_REGISTER',
      path: '/sdk/register',
      query: '',
      body: '',
      requestId: msg.requestId,
      timestamp: msg.ts,
      requiredScope: 'tunnel:connect',
      ip,
      // The handshake opens a connection; only sdk:request counts as usage.
      countUsage: false,
    });

    if (!result.valid) throw new HubAuthError(result.code, result.reason);

    return {
      accountId: result.accountId,
      keyId: msg.keyId,
      scopes: result.scopes,
    };
  }

  /**
   * Authenticate an SDK tunnel request.
   * Called on EVERY sdk:request message — must be fast.
   * Redis cache hit = ~1ms. Postgres fallback = ~3ms.
   */
  async authenticateRequest(
    msg: SdkRequestMsg,
    ip: string,
    credential?: SdkCredential & { keyId: string },
  ): Promise<HubAuthResult> {
    this.checkTimestamp(msg.ts);

    // A TunnelClient connection authenticated with its raw secret signs each
    // request with that secret. Check it here, then hand the validator the
    // same request signed with the stored hash, so replay protection, rate
    // limits, key/account status and usage all run exactly as before.
    let signature = msg.signature;
    if (credential) {
      if (msg.keyId !== credential.keyId) {
        throw new HubAuthError('INVALID_SIGNATURE', 'Request key does not match this connection');
      }
      const canonical = buildCanonical({
        method: msg.method,
        path: msg.path,
        query: msg.query ?? '',
        body: msg.body ?? '',
        requestId: msg.requestId,
        ts: msg.ts,
      });
      if (!verifyCanonical(canonical, msg.signature, credential.rawSecret)) {
        throw new HubAuthError('INVALID_SIGNATURE', 'HMAC signature verification failed');
      }
      signature = signCanonical(canonical, credential.secretHash);
    }

    const result = await this.validateKeyUseCase.execute({
      keyId: msg.keyId,
      signature,
      method: msg.method,
      path: msg.path,
      // Signed since audit H8: the query the hub forwards to the agent must be
      // the one the SDK signed (TunnelClient always included it).
      query: msg.query ?? '',
      body: msg.body ?? '',
      requestId: msg.requestId,
      timestamp: msg.ts,
      requiredScope: 'tunnel:connect',
      ip,
    });

    if (!result.valid) throw new HubAuthError(result.code, result.reason);

    return {
      accountId: result.accountId,
      keyId: msg.keyId,
      scopes: result.scopes,
    };
  }

  private checkTimestamp(ts: number): void {
    const delta = Math.abs(Date.now() - ts);
    if (delta > TIMING.SIGNATURE_WINDOW_MS) {
      throw new HubAuthError(
        'AUTH_FAILED',
        `Request timestamp is ${delta}ms outside the ${TIMING.SIGNATURE_WINDOW_MS}ms window`,
      );
    }
  }
}
