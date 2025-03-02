-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "breed" TEXT,
ADD COLUMN     "deadline" TEXT,
ADD COLUMN     "isBreeding" BOOLEAN DEFAULT false,
ADD COLUMN     "isExport" BOOLEAN DEFAULT false,
ADD COLUMN     "region" TEXT;
