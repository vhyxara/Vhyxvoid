// identity/domain/repositories/SessionRepository.ts

import { Session } from "@/modules/identity/domain/entities/user/Session.entities";

export interface SessionRepository {
  save(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  revokeById(id: string): Promise<void>;
  countActiveByUserId(userId: string, now: Date): Promise<number>;
  revokeOldestActiveSession(userId: string, now: Date): Promise<void>;
  revokeAllByUserId(userId: string, now: Date): Promise<void>;
}
