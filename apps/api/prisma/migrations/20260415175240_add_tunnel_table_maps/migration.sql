/*
  Warnings:

  - You are about to drop the `TunnelRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TunnelSession` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TunnelRequest" DROP CONSTRAINT "TunnelRequest_accountId_fkey";

-- DropForeignKey
ALTER TABLE "TunnelRequest" DROP CONSTRAINT "TunnelRequest_apiKeyId_fkey";

-- DropForeignKey
ALTER TABLE "TunnelRequest" DROP CONSTRAINT "TunnelRequest_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "TunnelSession" DROP CONSTRAINT "TunnelSession_accountId_fkey";

-- DropForeignKey
ALTER TABLE "TunnelSession" DROP CONSTRAINT "TunnelSession_apiKeyId_fkey";

-- DropTable
DROP TABLE "TunnelRequest";

-- DropTable
DROP TABLE "TunnelSession";

-- CreateTable
CREATE TABLE "tunnel_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "TunnelSessionStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "hubInstanceId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "tunnel_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tunnel_requests" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tunnel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tunnel_sessions_agentId_key" ON "tunnel_sessions"("agentId");

-- CreateIndex
CREATE INDEX "tunnel_sessions_accountId_idx" ON "tunnel_sessions"("accountId");

-- CreateIndex
CREATE INDEX "tunnel_sessions_accountId_status_idx" ON "tunnel_sessions"("accountId", "status");

-- CreateIndex
CREATE INDEX "tunnel_sessions_apiKeyId_idx" ON "tunnel_sessions"("apiKeyId");

-- CreateIndex
CREATE INDEX "tunnel_sessions_connectedAt_idx" ON "tunnel_sessions"("connectedAt");

-- CreateIndex
CREATE INDEX "tunnel_sessions_hubInstanceId_idx" ON "tunnel_sessions"("hubInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "tunnel_requests_requestId_key" ON "tunnel_requests"("requestId");

-- CreateIndex
CREATE INDEX "tunnel_requests_accountId_idx" ON "tunnel_requests"("accountId");

-- CreateIndex
CREATE INDEX "tunnel_requests_sessionId_idx" ON "tunnel_requests"("sessionId");

-- CreateIndex
CREATE INDEX "tunnel_requests_requestId_idx" ON "tunnel_requests"("requestId");

-- CreateIndex
CREATE INDEX "tunnel_requests_createdAt_idx" ON "tunnel_requests"("createdAt");

-- CreateIndex
CREATE INDEX "tunnel_requests_accountId_createdAt_idx" ON "tunnel_requests"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "tunnel_requests_apiKeyId_createdAt_idx" ON "tunnel_requests"("apiKeyId", "createdAt");

-- AddForeignKey
ALTER TABLE "tunnel_sessions" ADD CONSTRAINT "tunnel_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tunnel_sessions" ADD CONSTRAINT "tunnel_sessions_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tunnel_requests" ADD CONSTRAINT "tunnel_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tunnel_requests" ADD CONSTRAINT "tunnel_requests_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tunnel_requests" ADD CONSTRAINT "tunnel_requests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "tunnel_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
