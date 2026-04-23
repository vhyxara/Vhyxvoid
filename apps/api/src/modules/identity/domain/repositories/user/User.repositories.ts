// identity/domain/repositories/UserRepository.ts

import { User } from "@/modules/identity/domain/entities/user/User.entities";
import { Email } from "@/modules/identity/domain/value-objects/Email";

export interface UserRepository {
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>; // FIX: was Email VO, now string
  findAll(filters?: { status?: boolean; isDeleted?: boolean }): Promise<User[]>;
  countTotal(): Promise<number>;
}
