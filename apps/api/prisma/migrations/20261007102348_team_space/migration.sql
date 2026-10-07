-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MENTION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_REPLY';

-- CreateTable
CREATE TABLE "team_channels" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CHANNEL',
    "name" TEXT,
    "topic" TEXT NOT NULL DEFAULT '',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "dmKey" TEXT,
    "refKind" TEXT,
    "refId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_channel_members" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "joined" BOOLEAN NOT NULL DEFAULT true,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_channel_members_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "team_messages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refs" JSONB NOT NULL DEFAULT '[]',
    "reactions" JSONB NOT NULL DEFAULT '{}',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_events" (
    "seq" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "team_folders" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_docs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_doc_versions" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_doc_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_comments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "anchor" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolvedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_issues" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'NONE',
    "assigneeId" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueDate" DATE,
    "refs" JSONB NOT NULL DEFAULT '[]',
    "rank" TEXT NOT NULL,
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_issue_events" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "from" JSONB,
    "to" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_issue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member_prefs" (
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "emailDigest" BOOLEAN NOT NULL DEFAULT true,
    "lastDigestAt" TIMESTAMP(3),

    CONSTRAINT "team_member_prefs_pkey" PRIMARY KEY ("userId","accountId")
);

-- CreateIndex
CREATE INDEX "team_channels_accountId_refKind_refId_idx" ON "team_channels"("accountId", "refKind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "team_channels_accountId_name_key" ON "team_channels"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "team_channels_accountId_dmKey_key" ON "team_channels"("accountId", "dmKey");

-- CreateIndex
CREATE INDEX "team_channel_members_userId_accountId_idx" ON "team_channel_members"("userId", "accountId");

-- CreateIndex
CREATE INDEX "team_messages_channelId_createdAt_idx" ON "team_messages"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "team_messages_parentId_createdAt_idx" ON "team_messages"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "team_messages_accountId_createdAt_idx" ON "team_messages"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "team_events_createdAt_idx" ON "team_events"("createdAt");

-- CreateIndex
CREATE INDEX "team_folders_accountId_idx" ON "team_folders"("accountId");

-- CreateIndex
CREATE INDEX "team_docs_accountId_folderId_idx" ON "team_docs"("accountId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "team_doc_versions_docId_number_key" ON "team_doc_versions"("docId", "number");

-- CreateIndex
CREATE INDEX "team_comments_targetKind_targetId_createdAt_idx" ON "team_comments"("targetKind", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "team_issues_accountId_status_rank_idx" ON "team_issues"("accountId", "status", "rank");

-- CreateIndex
CREATE INDEX "team_issues_accountId_assigneeId_idx" ON "team_issues"("accountId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "team_issues_accountId_number_key" ON "team_issues"("accountId", "number");

-- CreateIndex
CREATE INDEX "team_issue_events_issueId_createdAt_idx" ON "team_issue_events"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "team_channels" ADD CONSTRAINT "team_channels_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_channel_members" ADD CONSTRAINT "team_channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "team_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "team_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_folders" ADD CONSTRAINT "team_folders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_docs" ADD CONSTRAINT "team_docs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_doc_versions" ADD CONSTRAINT "team_doc_versions_docId_fkey" FOREIGN KEY ("docId") REFERENCES "team_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_comments" ADD CONSTRAINT "team_comments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_issues" ADD CONSTRAINT "team_issues_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_issue_events" ADD CONSTRAINT "team_issue_events_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "team_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member_prefs" ADD CONSTRAINT "team_member_prefs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

