export interface GetAccountMembersParams {
  accountId: string;
  actorUserId: string;
  page?: number;
  limit?: number;
  search?: string; // filter by userId or email (requires user join)
  sortBy?: "roleLevel" | "joinedAt" | "name" | "email";
  sortOrder?: "asc" | "desc";
}

export interface AccountMemberDTO {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  isEmailVerified: boolean;
  role: {
    id: string;
    name: string;
    level: number;
    levelName: string;
    description: string | null;
  };
  joinedAt: Date;
  isYou: boolean; // whether this member is the requester
  canManage: boolean; // whether the requester can manage this member (e.g. change role, remove)
  user: {
    email: string;
    firstName: string;
    lastName: string;
    fullName: string;
    isEmailVerified: boolean;
  } | null; // user details if available, null if user record is missing
}

export interface GetAccountMembersResult {
  items: AccountMemberDTO[];
  total: number;
  page: number;
  limit: number;
}
