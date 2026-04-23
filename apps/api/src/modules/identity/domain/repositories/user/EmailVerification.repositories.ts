// identity/domain/repositories/EmailVerificationRepository.ts

import { EmailVerificationToken } from "@/modules/identity/domain/entities/user/EmailVerificationToken.entities";

export interface EmailVerificationTokenRepository {
  save(token: EmailVerificationToken): Promise<void>;
  findByHash(tokenHash: string): Promise<EmailVerificationToken | null>;
}
