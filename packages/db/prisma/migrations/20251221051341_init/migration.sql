-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "ltree";

-- CreateTable
CREATE TABLE "Provider" (
    "id" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" VARCHAR(32) NOT NULL,
    "bucketCapacity" INTEGER NOT NULL,
    "bucketRefillAmount" INTEGER NOT NULL,
    "bucketRefillIntervalSeconds" INTEGER NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierModel" (
    "id" UUID NOT NULL,
    "tierId" VARCHAR(32) NOT NULL,
    "modelId" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" VARCHAR(191) NOT NULL,
    "email" VARCHAR(128) NOT NULL,
    "preferences" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProviderKey" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProviderKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCustomProvider" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCustomProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserByokModel" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "sourceType" VARCHAR(16) NOT NULL,
    "providerId" VARCHAR(64),
    "customProviderId" UUID,
    "providerModelId" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(256) NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "maxOutputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserByokModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRateLimit" (
    "userId" VARCHAR(191) NOT NULL,
    "tokens" INTEGER NOT NULL,
    "lastRefill" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRateLimit_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ChatDeletion" (
    "id" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(191) NOT NULL,

    CONSTRAINT "ChatDeletion_pkey" PRIMARY KEY ("id")
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "userId" VARCHAR(191) NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "lastContext" JSONB,
    "settings" JSONB,
    "parentChatId" UUID,
    "forkedFromMessageId" UUID,
    "forkDepth" INTEGER NOT NULL DEFAULT 0,
    "rootMessageIndex" INTEGER NOT NULL DEFAULT 0,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT,
    "path" ltree NOT NULL,
    "path_text" TEXT,
    "selectedChildIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
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
    "creator" VARCHAR(64) NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportedFormats" TEXT[],
    "maxOutputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" UUID NOT NULL,
    "modelId" VARCHAR(256) NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "providerModelId" VARCHAR(256) NOT NULL,
    "customPlatformProviderId" UUID,
    "pricing" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCatalog" (
    "id" UUID NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "providerModelId" VARCHAR(256) NOT NULL,
    "suggestedModelId" VARCHAR(256),
    "suggestedName" VARCHAR(256),
    "suggestedCreator" VARCHAR(64),
    "supportsTools" BOOLEAN NOT NULL DEFAULT false,
    "supportedFormats" TEXT[],
    "pricing" JSONB,
    "rawData" JSONB,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" VARCHAR(128) NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" UUID NOT NULL,
    "userId" VARCHAR(191),
    "model" VARCHAR(256) NOT NULL,
    "byok" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "inputMTokenPriceMicros" INTEGER,
    "outputMTokenPriceMicros" INTEGER,
    "reasoningMTokenPriceMicros" INTEGER,
    "cachedInputMTokenPriceMicros" INTEGER,
    "extrasCostMicros" INTEGER,
    "totalCostMicros" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCustomProvider" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCustomProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCustomModel" (
    "id" UUID NOT NULL,
    "modelSlug" VARCHAR(256) NOT NULL,
    "displayName" VARCHAR(256) NOT NULL,
    "providerId" UUID NOT NULL,
    "providerModelId" VARCHAR(256) NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportedFormats" TEXT[],
    "maxOutputTokens" INTEGER,
    "pricing" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCustomModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TierModel_tierId_idx" ON "TierModel"("tierId");

-- CreateIndex
CREATE INDEX "TierModel_modelId_idx" ON "TierModel"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "TierModel_tierId_modelId_key" ON "TierModel"("tierId", "modelId");

-- CreateIndex
CREATE INDEX "UserProviderKey_userId_idx" ON "UserProviderKey"("userId");

-- CreateIndex
CREATE INDEX "UserProviderKey_providerId_idx" ON "UserProviderKey"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProviderKey_userId_providerId_key" ON "UserProviderKey"("userId", "providerId");

-- CreateIndex
CREATE INDEX "UserCustomProvider_userId_idx" ON "UserCustomProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCustomProvider_userId_slug_key" ON "UserCustomProvider"("userId", "slug");

-- CreateIndex
CREATE INDEX "UserByokModel_userId_idx" ON "UserByokModel"("userId");

-- CreateIndex
CREATE INDEX "UserByokModel_providerId_idx" ON "UserByokModel"("providerId");

-- CreateIndex
CREATE INDEX "UserByokModel_customProviderId_idx" ON "UserByokModel"("customProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "UserByokModel_userId_sourceType_providerId_customProviderId_key" ON "UserByokModel"("userId", "sourceType", "providerId", "customProviderId", "providerModelId");

-- CreateIndex
CREATE INDEX "ChatDeletion_userId_deletedAt_idx" ON "ChatDeletion"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Chat_parentChatId_idx" ON "Chat"("parentChatId");

-- CreateIndex
CREATE INDEX "Message_chatId_idx" ON "Message"("chatId");

-- CreateIndex
CREATE INDEX "Message_chatId_path_text_idx" ON "Message"("chatId", "path_text");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_path_key" ON "Message"("chatId", "path");

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
CREATE INDEX "Model_creator_idx" ON "Model"("creator");

-- CreateIndex
CREATE INDEX "ModelProvider_providerId_idx" ON "ModelProvider"("providerId");

-- CreateIndex
CREATE INDEX "ModelProvider_modelId_idx" ON "ModelProvider"("modelId");

-- CreateIndex
CREATE INDEX "ModelProvider_customPlatformProviderId_idx" ON "ModelProvider"("customPlatformProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelProvider_modelId_providerId_key" ON "ModelProvider"("modelId", "providerId");

-- CreateIndex
CREATE INDEX "ProviderCatalog_providerId_idx" ON "ProviderCatalog"("providerId");

-- CreateIndex
CREATE INDEX "ProviderCatalog_suggestedModelId_idx" ON "ProviderCatalog"("suggestedModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCatalog_providerId_providerModelId_key" ON "ProviderCatalog"("providerId", "providerModelId");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_idx" ON "TokenUsage"("userId");

-- CreateIndex
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_model_idx" ON "TokenUsage"("model");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCustomProvider_slug_key" ON "PlatformCustomProvider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCustomModel_modelSlug_key" ON "PlatformCustomModel"("modelSlug");

-- CreateIndex
CREATE INDEX "PlatformCustomModel_providerId_idx" ON "PlatformCustomModel"("providerId");

-- AddForeignKey
ALTER TABLE "TierModel" ADD CONSTRAINT "TierModel_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierModel" ADD CONSTRAINT "TierModel_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProviderKey" ADD CONSTRAINT "UserProviderKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCustomProvider" ADD CONSTRAINT "UserCustomProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserByokModel" ADD CONSTRAINT "UserByokModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserByokModel" ADD CONSTRAINT "UserByokModel_userId_providerId_fkey" FOREIGN KEY ("userId", "providerId") REFERENCES "UserProviderKey"("userId", "providerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserByokModel" ADD CONSTRAINT "UserByokModel_customProviderId_fkey" FOREIGN KEY ("customProviderId") REFERENCES "UserCustomProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "ModelProvider" ADD CONSTRAINT "ModelProvider_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelProvider" ADD CONSTRAINT "ModelProvider_customPlatformProviderId_fkey" FOREIGN KEY ("customPlatformProviderId") REFERENCES "PlatformCustomProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCustomModel" ADD CONSTRAINT "PlatformCustomModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PlatformCustomProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

