/*
  Warnings:

  - The primary key for the `ContactRequest` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `quantity` on the `ContactRequest` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `ContactRequest` table. All the data in the column will be lost.
  - Added the required column `buyerId` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerId` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_userId_fkey";

-- DropIndex
DROP INDEX "ContactRequest_offerId_idx";

-- DropIndex
DROP INDEX "ContactRequest_userId_idx";

-- DropIndex
DROP INDEX "offers_userId_idx";

-- AlterTable
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_pkey",
DROP COLUMN "quantity",
DROP COLUMN "userId",
ADD COLUMN     "buyerId" TEXT NOT NULL,
ADD COLUMN     "sellerId" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "ContactRequest_id_seq";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
