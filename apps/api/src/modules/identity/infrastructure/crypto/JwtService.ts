import jwt from 'jsonwebtoken';
import fs from 'fs';

export class RS256JwtService {
  #privateKey: string;
  #publicKey: string;

  constructor(privateKeyPath: string, publicKeyPath: string) {
    this.#privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
    this.#publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
  }

  sign(payload: object, options?: jwt.SignOptions): string {
    return jwt.sign(payload, this.#privateKey, { algorithm: 'RS256', ...options });
  }

  verify(token: string): any {
    return jwt.verify(token, this.#publicKey, { algorithms: ['RS256'] });
  }
}
