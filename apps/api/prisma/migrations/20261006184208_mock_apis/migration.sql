-- CreateEnum
CREATE TYPE "MockApiMode" AS ENUM ('ALWAYS', 'OFFLINE');

-- CreateTable
CREATE TABLE "mock_apis" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "MockApiMode" NOT NULL DEFAULT 'ALWAYS',
    "cors" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "endpoints" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_apis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mock_apis_accountId_label_key" ON "mock_apis"("accountId", "label");

-- AddForeignKey
ALTER TABLE "mock_apis" ADD CONSTRAINT "mock_apis_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
