import { SecurityEventType } from "@/core/types/api-key.types/apiKeys";
import { SecurityEventProps } from "@/core/types/api-key.types/securityEvent";

export class SecurityEvent {
  private constructor(private props: SecurityEventProps) {}

  static create(params: {
    apiKeyId?: string;
    accountId?: string;
    type: SecurityEventType;
    ip?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): SecurityEvent {
    return new SecurityEvent({
      id: crypto.randomUUID(),
      apiKeyId: params.apiKeyId ?? null,
      accountId: params.accountId ?? null,
      type: params.type,
      ip: params.ip ?? null,
      reason: params.reason ?? null,
      metadata: params.metadata ?? null,
      createdAt: new Date(),
    });
  }

  static rehydrate(props: SecurityEventProps): SecurityEvent {
    return new SecurityEvent(props);
  }

  get id(): string {
    return this.props.id;
  }
  get apiKeyId(): string | null {
    return this.props.apiKeyId;
  }
  get accountId(): string | null {
    return this.props.accountId;
  }
  get type(): SecurityEventType {
    return this.props.type;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  toPersistence(): SecurityEventProps {
    return { ...this.props };
  }
}
