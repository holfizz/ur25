/*
  Warnings:

  - The values [GRANT_MEMBER] on the enum `BuyerType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BuyerType_new" AS ENUM ('PRIVATE', 'FARM', 'AGRICULTURAL', 'MEAT_FACTORY', 'FEEDLOT', 'GRANT');
ALTER TABLE "users" ALTER COLUMN "buyerType" TYPE "BuyerType_new" USING ("buyerType"::text::"BuyerType_new");
ALTER TYPE "BuyerType" RENAME TO "BuyerType_old";
ALTER TYPE "BuyerType_new" RENAME TO "BuyerType";
DROP TYPE "BuyerType_old";
COMMIT;
