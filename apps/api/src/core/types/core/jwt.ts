export interface JwtPayload {
  sub: string;
  userId: string;
  email: string;
  roles: string[];
  abilities?: string[];
  tokenVersion?: number;
  /** Token audience: "user" (apps/web) or "admin" (apps/admin); each guard accepts only its own. */
  type?: "user" | "admin";
}
