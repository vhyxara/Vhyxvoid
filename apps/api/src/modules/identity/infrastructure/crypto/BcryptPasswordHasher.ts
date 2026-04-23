import bcrypt from 'bcryptjs';
import { PasswordHasher } from '@/modules/identity/domain/services/PasswordHasher';

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly saltRounds = 12) {}

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
