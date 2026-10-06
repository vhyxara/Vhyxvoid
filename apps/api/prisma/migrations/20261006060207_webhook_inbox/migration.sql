-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('QUEUED', 'DELIVERING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "tunnel_inboxes" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tunnel_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_requests" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" BYTEA,
    "bodySize" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InboxStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "responseStatus" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tunnel_inboxes_accountId_label_key" ON "tunnel_inboxes"("accountId", "label");

-- CreateIndex
CREATE INDEX "inbox_requests_accountId_label_status_receivedAt_idx" ON "inbox_requests"("accountId", "label", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "inbox_requests_status_nextAttemptAt_idx" ON "inbox_requests"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "inbox_requests_receivedAt_idx" ON "inbox_requests"("receivedAt");

-- AddForeignKey
ALTER TABLE "tunnel_inboxes" ADD CONSTRAINT "tunnel_inboxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_requests" ADD CONSTRAINT "inbox_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
