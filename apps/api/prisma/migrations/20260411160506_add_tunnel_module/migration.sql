/*
  Warnings:

  - A unique constraint covering the columns `[agentId]` on the table `TunnelSession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `agentId` to the `TunnelSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TunnelSession" ADD COLUMN     "agentId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "TunnelRequest_apiKeyId_createdAt_idx" ON "TunnelRequest"("apiKeyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TunnelSession_agentId_key" ON "TunnelSession"("agentId");

-- CreateIndex
CREATE INDEX "TunnelSession_hubInstanceId_idx" ON "TunnelSession"("hubInstanceId");
