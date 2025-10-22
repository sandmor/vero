-- ltree extension
CREATE EXTENSION IF NOT EXISTS ltree;

-- CreateTable
CREATE TABLE "Provider" (
    "id" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" VARCHAR(32) NOT NULL,
    "modelIds" TEXT[],
    "bucketCapacity" INTEGER NOT NULL,
    "bucketRefillAmount" INTEGER NOT NULL,
    "bucketRefillIntervalSeconds" INTEGER NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" VARCHAR(191) NOT NULL,
    "email" VARCHAR(128) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRateLimit" (
    "userId" VARCHAR(191) NOT NULL,
    "tokens" INTEGER NOT NULL,
    "lastRefill" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRateLimit_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "lastContext" JSONB,
    "settings" JSONB,
    "parentChatId" UUID,
    "forkedFromMessageId" UUID,
    "forkDepth" INTEGER NOT NULL DEFAULT 0,
    "agentId" UUID,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "attachments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "model" TEXT,
    "path" ltree NOT NULL,
    "path_text" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- Columns
ALTER TABLE "Message"
  ADD COLUMN "path" ltree NOT NULL,
  ADD COLUMN "path_text" text GENERATED ALWAYS AS ("path"::text) STORED;

-- Shape constraint
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_path_shape_chk"
  CHECK (("path")::text ~ '^(_[0-9a-z]{2})(\._[0-9a-z]{2})*$');

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "userId" VARCHAR(191) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id","createdAt")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "documentCreatedAt" TIMESTAMP(3) NOT NULL,
    "originalText" TEXT NOT NULL,
    "suggestedText" TEXT NOT NULL,
    "description" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "userId" VARCHAR(191) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveEntry" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "entity" TEXT NOT NULL,
    "tags" TEXT[],
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatPinnedArchiveEntry" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "archiveEntryId" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPinnedArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveLink" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "bidirectional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Model" (
    "id" VARCHAR(256) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportedFormats" TEXT[],
    "pricing" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" VARCHAR(128) NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chat_parentChatId_idx" ON "Chat"("parentChatId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Chat_title_gin_idx" ON "Chat" USING gin(to_tsvector('simple', title));

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Chat_userId_createdAt_idx" ON "Chat"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_chatId_idx" ON "Message"("chatId");

-- CreateIndex
CREATE INDEX "Message_chatId_path_text_idx" ON "Message"("chatId", "path_text");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_path_key" ON "Message"("chatId", "path");

-- CreateIndex
CREATE INDEX "Message_path_gist_idx" ON "Message" USING GIST ("path");

-- CreateIndex
CREATE INDEX "ArchiveEntry_userId_slug_idx" ON "ArchiveEntry"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveEntry_userId_slug_key" ON "ArchiveEntry"("userId", "slug");

-- CreateIndex
CREATE INDEX "ChatPinnedArchiveEntry_chatId_idx" ON "ChatPinnedArchiveEntry"("chatId");

-- CreateIndex
CREATE INDEX "ChatPinnedArchiveEntry_archiveEntryId_idx" ON "ChatPinnedArchiveEntry"("archiveEntryId");

-- CreateIndex
CREATE INDEX "ChatPinnedArchiveEntry_userId_idx" ON "ChatPinnedArchiveEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatPinnedArchiveEntry_chatId_archiveEntryId_key" ON "ChatPinnedArchiveEntry"("chatId", "archiveEntryId");

-- CreateIndex
CREATE INDEX "ArchiveLink_sourceId_idx" ON "ArchiveLink"("sourceId");

-- CreateIndex
CREATE INDEX "ArchiveLink_targetId_idx" ON "ArchiveLink"("targetId");

-- CreateIndex
CREATE INDEX "ArchiveLink_type_idx" ON "ArchiveLink"("type");

-- CreateIndex
CREATE INDEX "Model_provider_idx" ON "Model"("provider");

-- AddForeignKey
ALTER TABLE "UserRateLimit" ADD CONSTRAINT "UserRateLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_documentId_documentCreatedAt_fkey" FOREIGN KEY ("documentId", "documentCreatedAt") REFERENCES "Document"("id", "createdAt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPinnedArchiveEntry" ADD CONSTRAINT "ChatPinnedArchiveEntry_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPinnedArchiveEntry" ADD CONSTRAINT "ChatPinnedArchiveEntry_archiveEntryId_fkey" FOREIGN KEY ("archiveEntryId") REFERENCES "ArchiveEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPinnedArchiveEntry" ADD CONSTRAINT "ChatPinnedArchiveEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveLink" ADD CONSTRAINT "ArchiveLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ArchiveEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveLink" ADD CONSTRAINT "ArchiveLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ArchiveEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

