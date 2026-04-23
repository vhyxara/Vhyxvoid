// identity/domain/repositories/AdminUserRoleRepository.ts

export interface AdminUserRoleHistory {
  id: string;
  adminId: string;
  roleId: string;
  assignedBy: string;
  action: 'assigned' | 'revoked';
  reason?: string;
  createdAt: Date;
}

export interface AdminUserRoleHistoryRepository {
  save(history: AdminUserRoleHistory): Promise<void>;
  findByAdminId(adminId: string): Promise<AdminUserRoleHistory[]>;
  findByRoleId(roleId: string): Promise<AdminUserRoleHistory[]>;
  findByAssignedBy(assignedBy: string): Promise<AdminUserRoleHistory[]>;
}
