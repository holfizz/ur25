/*
  Warnings:

  - You are about to drop the column `contactName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `contactPhone` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "contactName",
DROP COLUMN "contactPhone",
DROP COLUMN "location";
