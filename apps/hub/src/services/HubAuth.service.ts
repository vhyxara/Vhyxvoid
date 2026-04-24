// // apps/hub/src/services/HubAuthService.ts
// // Connects Hub to the existing ValidateApiKeyUseCase.
// // No HTTP call — shared code import from packages/shared.

// import { ValidateApiKeyUseCase, SecurityEventType } from '@platform/shared';
// import {
//   buildCanonical,
//   verifyCanonical,
//   AgentRegisterMsg,
//   SdkRequestMsg,
//   SdkRegisterMsg,
//   TIMING,
// } from '@platform/protocol';

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

import { IValidateApiKeyUseCase, ValidateApiKeyParams } from '@platform/shared';
import { AgentRegisterMsg, SdkRegisterMsg, SdkRequestMsg, TIMING } from '@platform/protocol';

export interface HubAuthResult {
  accountId: string;
  keyId: string;
  scopes: string[];
  rateLimitPerMinute: number;
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
  constructor(private readonly validateKeyUseCase: IValidateApiKeyUseCase) {}

  /**
   * Authenticate an agent trying to register.
   * Called once per agent connection — on agent:register message.
   */
  async authenticateAgent(msg: AgentRegisterMsg, ip: string): Promise<HubAuthResult> {
    this.checkTimestamp(msg.ts);

    const result = await this.validateKeyUseCase.execute({
      keyId: msg.keyId,
      signature: msg.signature,
      method: 'AGENT_REGISTER',
      path: '/agent/register',
      body: msg.label, // label is the body for agent auth
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
      rateLimitPerMinute: result.rateLimitPerMinute,
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
      rateLimitPerMinute: result.rateLimitPerMinute,
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
      rateLimitPerMinute: result.rateLimitPerMinute,
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
