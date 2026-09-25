import { ValidationError } from "@/core/errors/error.format";
// identity/domain/entities/EmailVerificationToken.ts

export interface EmailVerificationTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export class EmailVerificationToken {
  private constructor(private props: EmailVerificationTokenProps) {}

  static create(params: {
    userId: string;
    tokenHash: string;
    ttlMs: number;
  }): EmailVerificationToken {
    const now = new Date();
    return new EmailVerificationToken({
      id: crypto.randomUUID(),
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: new Date(now.getTime() + params.ttlMs),
      usedAt: null,
    });
  }

  static rehydrate(props: EmailVerificationTokenProps): EmailVerificationToken {
    return new EmailVerificationToken(props);
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get usedAt(): Date | null {
    return this.props.usedAt;
  }

  ensureValid(now: Date): void {
    if (this.props.usedAt) throw new ValidationError('Token has already been used');
    if (this.props.expiresAt <= now) throw new ValidationError('Token has expired');
  }

  markUsed(now: Date): void {
    this.props.usedAt = now;
  }

  toPersistence(): EmailVerificationTokenProps {
    return { ...this.props };
  }
}
