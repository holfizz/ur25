/*
  Warnings:

  - You are about to drop the column `created_at` on the `requests` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `requests` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `requests` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Added the required column `updatedAt` to the `requests` table without a default value. This is not possible if the table is not empty.
  - Made the column `weight` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `age` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `location` on table `requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `price` on table `requests` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "requests" DROP COLUMN "created_at",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "weight" SET NOT NULL,
ALTER COLUMN "age" SET NOT NULL,
ALTER COLUMN "location" SET NOT NULL,
ALTER COLUMN "price" SET NOT NULL,
ALTER COLUMN "price" SET DATA TYPE INTEGER;
