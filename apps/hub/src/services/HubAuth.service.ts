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
import { AgentRegisterMsg, SdkRegisterMsg, SdkRequestMsg, TIMING } from '@vhyxvoid/protocol';
import crypto from 'crypto';
import { debugLog } from '@/utils/debug';

export interface HubAuthResult {
  accountId: string;
  keyId: string;
  scopes: string[];
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
    } | null>,
  ) {}

  /**
   * Authenticate an agent trying to register.
   * Called once per agent connection — on agent:register message.
   */
  async authenticateAgent(msg: AgentRegisterMsg, _ip: string): Promise<HubAuthResult> {
    // No timestamp check needed — this is a connection handshake not a request
    debugLog('[hub-auth] received agent register', { keyId: msg.keyId, label: msg.label });

    // Load key from cache/DB
    const key = await this.loadKeyHash(msg.keyId);
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

    // Verify raw secret — hub applies pepper server-side
    // Never log expectedHash/storedHash/pepper length here, even behind a
    // debug flag — these are secret-adjacent values. See context.md risk #8.
    const expectedHash = crypto
      .createHmac('sha256', this.pepper)
      .update(msg.rawSecret)
      .digest('hex');
    const storedHash = Buffer.from(key.secretHash, 'hex');
    const computedHash = Buffer.from(expectedHash, 'hex');

    if (storedHash.length !== computedHash.length) {
      throw new HubAuthError('INVALID_SIGNATURE', 'HMAC signature verification failed');
    }

    const isValid = crypto.timingSafeEqual(storedHash, computedHash);
    if (!isValid) {
      throw new HubAuthError('INVALID_SIGNATURE', 'HMAC signature verification failed');
    }

    // Check scope
    const hasScope = key.scopes.includes('*') || key.scopes.includes('tunnel:connect');
    if (!hasScope) {
      throw new HubAuthError('SCOPE_MISSING', 'Key missing tunnel:connect scope');
    }

    return {
      accountId: key.accountId,
      keyId: msg.keyId,
      scopes: key.scopes,
    };
  }
  /**
   * Authenticate an SDK registration handshake.
   * Called once per SDK connection — on sdk:register message.
   */
  async authenticateSdkRegister(msg: SdkRegisterMsg, ip: string): Promise<HubAuthResult> {
    this.checkTimestamp(msg.ts);

    const result = await this.validateKeyUseCase.execute({
      keyId: msg.keyId,
      signature: msg.signature,
      method: 'SDK_REGISTER',
      path: '/sdk/register',
      body: '',
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

  /**
   * Authenticate an SDK tunnel request.
   * Called on EVERY sdk:request message — must be fast.
   * Redis cache hit = ~1ms. Postgres fallback = ~3ms.
   */
  async authenticateRequest(msg: SdkRequestMsg, ip: string): Promise<HubAuthResult> {
    this.checkTimestamp(msg.ts);

    const result = await this.validateKeyUseCase.execute({
      keyId: msg.keyId,
      signature: msg.signature,
      method: msg.method,
      path: msg.path,
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
