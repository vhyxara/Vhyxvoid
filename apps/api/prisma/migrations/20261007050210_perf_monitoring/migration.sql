-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'MONITOR';

-- CreateTable
CREATE TABLE "tunnel_endpoint_stats" (
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "s2xx" INTEGER NOT NULL DEFAULT 0,
    "s3xx" INTEGER NOT NULL DEFAULT 0,
    "s4xx" INTEGER NOT NULL DEFAULT 0,
    "s5xx" INTEGER NOT NULL DEFAULT 0,
    "totalMs" BIGINT NOT NULL DEFAULT 0,
    "maxMs" INTEGER NOT NULL DEFAULT 0,
    "hist" INTEGER[],
    "sample" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "tunnel_endpoint_stats_pkey" PRIMARY KEY ("accountId","label","method","route","bucket")
);

-- CreateTable
CREATE TABLE "load_tests" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "summary" JSONB,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "instance" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_monitors" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "environmentId" TEXT,
    "folderId" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDurationMs" INTEGER,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_monitor_results" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "errored" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "report" JSONB,

    CONSTRAINT "api_monitor_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tunnel_endpoint_stats_bucket_idx" ON "tunnel_endpoint_stats"("bucket");

-- CreateIndex
CREATE INDEX "tunnel_endpoint_stats_accountId_bucket_idx" ON "tunnel_endpoint_stats"("accountId", "bucket");

-- CreateIndex
CREATE INDEX "load_tests_accountId_createdAt_idx" ON "load_tests"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "load_tests_status_idx" ON "load_tests"("status");

-- CreateIndex
CREATE INDEX "api_monitors_enabled_nextRunAt_idx" ON "api_monitors"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "api_monitors_accountId_idx" ON "api_monitors"("accountId");

-- CreateIndex
CREATE INDEX "api_monitor_results_monitorId_at_idx" ON "api_monitor_results"("monitorId", "at");

-- CreateIndex
CREATE INDEX "api_monitor_results_at_idx" ON "api_monitor_results"("at");

-- AddForeignKey
ALTER TABLE "load_tests" ADD CONSTRAINT "load_tests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_monitors" ADD CONSTRAINT "api_monitors_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_monitors" ADD CONSTRAINT "api_monitors_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "api_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_monitor_results" ADD CONSTRAINT "api_monitor_results_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "api_monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
