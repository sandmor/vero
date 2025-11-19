/*
  Warnings:

  - You are about to drop the column `headMessageId` on the `Chat` table. All the data in the column will be lost.
  - Made the column `rootMessageIndex` on table `Chat` required. This step will fail if there are existing NULL values in that column.
  - Made the column `selectedChildIndex` on table `Message` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_headMessageId_fkey";

-- DropIndex
DROP INDEX "Chat_headMessageId_key";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "headMessageId",
ALTER COLUMN "rootMessageIndex" SET NOT NULL,
ALTER COLUMN "rootMessageIndex" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "selectedChildIndex" SET NOT NULL,
ALTER COLUMN "selectedChildIndex" SET DEFAULT 0;
