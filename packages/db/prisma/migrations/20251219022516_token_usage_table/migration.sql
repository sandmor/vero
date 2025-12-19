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

-- CreateIndex
CREATE INDEX "TokenUsage_userId_idx" ON "TokenUsage"("userId");

-- CreateIndex
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_model_idx" ON "TokenUsage"("model");

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
