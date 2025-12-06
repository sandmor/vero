-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "rootMessageIndex" INTEGER;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "selectedChildIndex" INTEGER;
