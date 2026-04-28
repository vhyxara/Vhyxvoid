import jwt from "jsonwebtoken";
import fs from "fs";

export class RS256JwtService {
  #privateKey: string;
  #publicKey: string;

  constructor(privateKey: string, publicKey: string) {
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
  }

  sign(payload: object, options?: jwt.SignOptions): string {
    return jwt.sign(payload, this.#privateKey, {
      algorithm: "RS256",
      ...options,
    });
  }

  verify(token: string): any {
    return jwt.verify(token, this.#publicKey, { algorithms: ["RS256"] });
  }
}
