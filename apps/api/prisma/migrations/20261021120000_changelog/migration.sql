-- CreateEnum
CREATE TYPE "ChangelogStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ChangelogStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "changelog_entries_status_publishedAt_idx" ON "changelog_entries"("status", "publishedAt");

