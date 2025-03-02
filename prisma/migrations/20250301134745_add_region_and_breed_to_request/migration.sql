/*
  Warnings:

  - The `deadline` column on the `requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `breed` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `isBreeding` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `isExport` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `region` on table `requests` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "requests" ALTER COLUMN "breed" SET NOT NULL,
DROP COLUMN "deadline",
ADD COLUMN     "deadline" TIMESTAMP(3),
ALTER COLUMN "isBreeding" SET NOT NULL,
ALTER COLUMN "isExport" SET NOT NULL,
ALTER COLUMN "region" SET NOT NULL;
