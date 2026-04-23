export interface AuditLogData {
  accountId?: string;
  userId?: string; // who performed the action
  targetUserId?: string; // FIX: was never populated — now explicit in the interface
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogRepository {
  create(data: AuditLogData): Promise<void>;
}
