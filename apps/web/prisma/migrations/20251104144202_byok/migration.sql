-- CreateTable
CREATE TABLE "UserApiKey" (
    "userId" VARCHAR(191) NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "apiKey" TEXT NOT NULL,
    "modelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "UserApiKey_userId_idx" ON "UserApiKey"("userId");

-- CreateIndex
CREATE INDEX "UserApiKey_providerId_idx" ON "UserApiKey"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserApiKey_userId_providerId_key" ON "UserApiKey"("userId", "providerId");

-- AddForeignKey
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
