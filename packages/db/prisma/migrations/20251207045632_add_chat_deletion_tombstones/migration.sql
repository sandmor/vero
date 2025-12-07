-- CreateTable
CREATE TABLE "ChatDeletion" (
    "id" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(191) NOT NULL,

    CONSTRAINT "ChatDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatDeletion_userId_deletedAt_idx" ON "ChatDeletion"("userId", "deletedAt");
