/*
  Warnings:

  - The `status` column on the `offers` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "offers" DROP COLUMN "status",
ADD COLUMN     "status" "OfferStatus" NOT NULL DEFAULT 'PENDING';
