export interface JwtPayload {
  userId: string;
  roles: string[];
  abilities?: string[];
}
