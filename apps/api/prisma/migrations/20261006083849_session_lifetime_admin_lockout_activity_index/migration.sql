-- AlterTable
ALTER TABLE "AdminSession" ADD COLUMN     "absoluteExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "absoluteExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");
