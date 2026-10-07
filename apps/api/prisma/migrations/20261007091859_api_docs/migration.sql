-- CreateEnum
CREATE TYPE "ApiSpecVisibility" AS ENUM ('PRIVATE', 'PUBLIC', 'PASSWORD');

-- CreateTable
CREATE TABLE "api_specs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "draftText" TEXT NOT NULL,
    "draftFormat" TEXT NOT NULL DEFAULT 'yaml',
    "version" INTEGER NOT NULL DEFAULT 1,
    "visibility" "ApiSpecVisibility" NOT NULL DEFAULT 'PRIVATE',
    "passwordHash" TEXT,
    "customDomain" TEXT,
    "customDomainToken" TEXT,
    "customDomainVerifiedAt" TIMESTAMP(3),
    "tryMockId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_spec_versions" (
    "id" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "breaking" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_spec_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_specs_customDomain_key" ON "api_specs"("customDomain");

-- CreateIndex
CREATE UNIQUE INDEX "api_specs_accountId_slug_key" ON "api_specs"("accountId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "api_spec_versions_specId_number_key" ON "api_spec_versions"("specId", "number");

-- AddForeignKey
ALTER TABLE "api_specs" ADD CONSTRAINT "api_specs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_spec_versions" ADD CONSTRAINT "api_spec_versions_specId_fkey" FOREIGN KEY ("specId") REFERENCES "api_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
