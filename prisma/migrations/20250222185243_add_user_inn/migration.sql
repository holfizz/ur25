/*
  Warnings:

  - You are about to drop the column `telegram_id` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[telegramId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "users_name_key";

-- DropIndex
DROP INDEX "users_telegram_id_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "telegram_id",
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "mercuryNumber" TEXT,
ADD COLUMN     "ogrn" TEXT,
ADD COLUMN     "telegramId" TEXT,
ALTER COLUMN "role" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");
