// ============================================================
// PASSWORD RESET TOKEN ENTITY
// Same pattern as EmailVerificationToken.
// One active token per user at a time — creating a new one
// invalidates the previous (by usedAt or by overwrite in repo).
// TTL: 1 hour. Single-use.
// ============================================================

export interface PasswordResetTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export class PasswordResetToken {
  private constructor(private props: PasswordResetTokenProps) {}

  static create(params: {
    userId: string;
    tokenHash: string;
    ttlMs: number;
  }): PasswordResetToken {
    const now = new Date();
    return new PasswordResetToken({
      id: crypto.randomUUID(),
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: new Date(now.getTime() + params.ttlMs),
      usedAt: null,
    });
  }

  static rehydrate(props: PasswordResetTokenProps): PasswordResetToken {
    return new PasswordResetToken(props);
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
    if (this.props.usedAt)
      throw new Error("Password reset token has already been used");
    if (this.props.expiresAt <= now)
      throw new Error("Password reset token has expired");
  }

  markUsed(now: Date): void {
    this.props.usedAt = now;
  }

  toPersistence(): PasswordResetTokenProps {
    return { ...this.props };
  }
}
