import crypto from 'crypto';

export class CryptoTokenGenerator {
  generate(length = 64): string {
    return crypto.randomBytes(length).toString('hex');
  }
}
