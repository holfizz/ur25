-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "lastActualityCheck" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
