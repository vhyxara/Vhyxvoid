-- CreateEnum
CREATE TYPE "TunnelSessionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EVICTED');

-- CreateTable
CREATE TABLE "TunnelSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "TunnelSessionStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "hubInstanceId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "TunnelSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TunnelRequest" (
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

    CONSTRAINT "TunnelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TunnelSession_accountId_idx" ON "TunnelSession"("accountId");

-- CreateIndex
CREATE INDEX "TunnelSession_accountId_status_idx" ON "TunnelSession"("accountId", "status");

-- CreateIndex
CREATE INDEX "TunnelSession_apiKeyId_idx" ON "TunnelSession"("apiKeyId");

-- CreateIndex
CREATE INDEX "TunnelSession_connectedAt_idx" ON "TunnelSession"("connectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TunnelRequest_requestId_key" ON "TunnelRequest"("requestId");

-- CreateIndex
CREATE INDEX "TunnelRequest_accountId_idx" ON "TunnelRequest"("accountId");

-- CreateIndex
CREATE INDEX "TunnelRequest_sessionId_idx" ON "TunnelRequest"("sessionId");

-- CreateIndex
CREATE INDEX "TunnelRequest_requestId_idx" ON "TunnelRequest"("requestId");

-- CreateIndex
CREATE INDEX "TunnelRequest_createdAt_idx" ON "TunnelRequest"("createdAt");

-- CreateIndex
CREATE INDEX "TunnelRequest_accountId_createdAt_idx" ON "TunnelRequest"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "TunnelSession" ADD CONSTRAINT "TunnelSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunnelSession" ADD CONSTRAINT "TunnelSession_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunnelRequest" ADD CONSTRAINT "TunnelRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunnelRequest" ADD CONSTRAINT "TunnelRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunnelRequest" ADD CONSTRAINT "TunnelRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TunnelSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
