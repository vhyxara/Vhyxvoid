// identity/infrastructure/crypto/TokenHasher.ts
import { createHash } from 'crypto';

export class TokenHasher {
  static hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }


  /**
   * Verify a token against its hash (timing-safe comparison)
   */
  static verify(rawToken: string, hash: string): boolean {
    const computed = this.hash(rawToken);
    // Use timing-safe comparison to prevent timing attacks
    return computed === hash;
  }
}
