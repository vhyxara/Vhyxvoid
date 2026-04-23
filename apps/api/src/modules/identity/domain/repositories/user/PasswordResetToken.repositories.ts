import { PasswordResetToken } from "@/modules/identity/domain/entities/user/PasswordResetToken.entities";

export interface PasswordResetTokenRepository {
  save(token: PasswordResetToken): Promise<void>;
  findByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  deleteAllByUserId(userId: string): Promise<void>;
}
