// identity/domain/services/JwtSigner.ts

export interface JwtPayload {
  sub: string;
  sid: string;
  type: 'access';
}

export interface JwtSigner {
  signAccessToken(payload: JwtPayload): Promise<string>;
}
