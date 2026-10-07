-- CreateTable
CREATE TABLE "api_collections" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "auth" JSONB NOT NULL DEFAULT '{"type":"none"}',
    "variables" JSONB NOT NULL DEFAULT '[]',
    "folders" JSONB NOT NULL DEFAULT '[]',
    "requests" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_environments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_history" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "size" INTEGER,
    "error" TEXT,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_test_runs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "environmentId" TEXT,
    "environmentName" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'dashboard',
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "errored" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "assertionsPassed" INTEGER NOT NULL DEFAULT 0,
    "assertionsFailed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_collections_accountId_idx" ON "api_collections"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "api_environments_accountId_name_key" ON "api_environments"("accountId", "name");

-- CreateIndex
CREATE INDEX "api_request_history_accountId_userId_createdAt_idx" ON "api_request_history"("accountId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "api_test_runs_collectionId_createdAt_idx" ON "api_test_runs"("collectionId", "createdAt");

-- CreateIndex
CREATE INDEX "api_test_runs_accountId_createdAt_idx" ON "api_test_runs"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "api_collections" ADD CONSTRAINT "api_collections_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_environments" ADD CONSTRAINT "api_environments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_history" ADD CONSTRAINT "api_request_history_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_history" ADD CONSTRAINT "api_request_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_test_runs" ADD CONSTRAINT "api_test_runs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_test_runs" ADD CONSTRAINT "api_test_runs_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "api_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
