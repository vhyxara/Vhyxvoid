// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/serializer.ts
// Single abstraction over serialization format.
// Phase 1: JSON (debug-friendly).
// Phase 2: swap to msgpackr here — zero other changes.
// ─────────────────────────────────────────────────────────────────────────────

import { PROTOCOL_VERSION } from "./constants";
import { HubErrorCode } from "./errors";
import { AnyHubMsg } from "./messages";

export function serialize(msg: AnyHubMsg): string {
  return JSON.stringify(msg);
}

export function deserialize<T = AnyHubMsg>(data: Buffer | string): T {
  const str = Buffer.isBuffer(data) ? data.toString("utf8") : data;
  return JSON.parse(str) as T;
}

/**
 * Parse and validate that a message has required base fields.
 * Throws a typed error on malformed input so routers can reject cleanly.
 */
export function parseMessage(data: Buffer | string): AnyHubMsg {
  let msg: any;
  try {
    msg = deserialize(data);
  } catch {
    throw new ProtocolError("INVALID_MESSAGE", "Message is not valid JSON");
  }

  if (!msg || typeof msg !== "object") {
    throw new ProtocolError("INVALID_MESSAGE", "Message must be a JSON object");
  }
  if (msg.v !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "VERSION_UNSUPPORTED",
      `Protocol version "${msg.v}" is not supported. Expected "${PROTOCOL_VERSION}".`,
    );
  }
  if (!msg.type || typeof msg.type !== "string") {
    throw new ProtocolError(
      "INVALID_MESSAGE",
      'Message missing required "type" field',
    );
  }

  return msg as AnyHubMsg;
}

export class ProtocolError extends Error {
  constructor(
    public readonly code: HubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}
