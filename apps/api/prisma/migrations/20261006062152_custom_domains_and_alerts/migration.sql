-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('TUNNEL_OFFLINE', 'ERROR_RATE', 'USAGE', 'INBOX_FAILED', 'DOMAIN');

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "routingOk" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "threshold" INTEGER,
    "windowMinutes" INTEGER,
    "minRequests" INTEGER,
    "notifyMembers" BOOLEAN NOT NULL DEFAULT true,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhookUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cursorAt" TIMESTAMP(3),

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_states" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "firing" BOOLEAN NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,

    CONSTRAINT "alert_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "deliveries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tunnel_minute_stats" (
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "errors4xx" INTEGER NOT NULL DEFAULT 0,
    "errors5xx" INTEGER NOT NULL DEFAULT 0,
    "totalMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "tunnel_minute_stats_pkey" PRIMARY KEY ("accountId","label","minute")
);

-- CreateTable
CREATE TABLE "job_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "custom_domains_hostname_idx" ON "custom_domains"("hostname");

-- CreateIndex
CREATE INDEX "custom_domains_verifiedAt_lastCheckedAt_idx" ON "custom_domains"("verifiedAt", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_accountId_hostname_key" ON "custom_domains"("accountId", "hostname");

-- CreateIndex
CREATE INDEX "alert_rules_accountId_idx" ON "alert_rules"("accountId");

-- CreateIndex
CREATE INDEX "alert_rules_enabled_type_idx" ON "alert_rules"("enabled", "type");

-- CreateIndex
CREATE UNIQUE INDEX "alert_states_ruleId_subject_key" ON "alert_states"("ruleId", "subject");

-- CreateIndex
CREATE INDEX "alert_events_accountId_createdAt_idx" ON "alert_events"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "alert_events_ruleId_createdAt_idx" ON "alert_events"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "tunnel_minute_stats_minute_idx" ON "tunnel_minute_stats"("minute");

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one verified claim per hostname (pending claims by several accounts are allowed).
CREATE UNIQUE INDEX "custom_domains_verified_hostname_key" ON "custom_domains"("hostname") WHERE "verifiedAt" IS NOT NULL;
