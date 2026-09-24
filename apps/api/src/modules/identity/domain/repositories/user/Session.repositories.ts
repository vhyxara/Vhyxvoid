// identity/domain/repositories/SessionRepository.ts

import { Session } from "@/modules/identity/domain/entities/user/Session.entities";

export interface SessionRepository {
  save(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  findByTokenHashForUpdate(tokenHash: string): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  purgeRotationCiphers(userId: string, olderThan: Date): Promise<void>;
  revokeById(id: string): Promise<void>;
  countActiveByUserId(userId: string, now: Date): Promise<number>;
  revokeOldestActiveSession(userId: string, now: Date): Promise<void>;
  revokeAllByUserId(userId: string, now: Date): Promise<void>;
}
