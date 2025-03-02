/*
  Warnings:

  - The primary key for the `ContactRequest` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `buyerId` on the `ContactRequest` table. All the data in the column will be lost.
  - You are about to drop the column `sellerId` on the `ContactRequest` table. All the data in the column will be lost.
  - The `id` column on the `ContactRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `quantity` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_sellerId_fkey";

-- AlterTable
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_pkey",
DROP COLUMN "buyerId",
DROP COLUMN "sellerId",
ADD COLUMN     "quantity" INTEGER NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ADD CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'BUYER';

-- CreateIndex
CREATE INDEX "ContactRequest_offerId_idx" ON "ContactRequest"("offerId");

-- CreateIndex
CREATE INDEX "ContactRequest_userId_idx" ON "ContactRequest"("userId");

-- CreateIndex
CREATE INDEX "offers_userId_idx" ON "offers"("userId");

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
