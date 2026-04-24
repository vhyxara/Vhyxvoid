export interface JwtPayload {
  sub: string;
  userId: string;
  email: string;
  roles: string[];
  abilities?: string[];
  tokenVersion?: number;
}
