// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE API KEY — Gateway critical path
// This is the data plane. Runs on every tunnel connection.
// ─────────────────────────────────────────────────────────────────────────────

import { SecurityEventType } from "@/core/constant/apikey.constant";

export interface GatewayValidationResult {
  valid: true;
  apiKeyId: string;
  accountId: string;
  scopes: string[];
}

export type GatewayValidationError = {
  valid: false;
  code: SecurityEventType;
  reason: string;
};
