/*
  Warnings:

  - The values [CALF,BULL_CALF,HEIFER,HEIFER_BRED,BULL,COW] on the enum `CattleType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `gutDiscount` on the `offers` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "CattleType_new" AS ENUM ('CALVES', 'BULL_CALVES', 'HEIFERS', 'BREEDING_HEIFERS', 'BULLS', 'COWS');
ALTER TABLE "offers" ALTER COLUMN "cattleType" TYPE "CattleType_new" USING ("cattleType"::text::"CattleType_new");
ALTER TYPE "CattleType" RENAME TO "CattleType_old";
ALTER TYPE "CattleType_new" RENAME TO "CattleType";
DROP TYPE "CattleType_old";
COMMIT;

-- AlterTable
ALTER TABLE "offers" DROP COLUMN "gutDiscount",
ADD COLUMN     "gktDiscount" DOUBLE PRECISION;
