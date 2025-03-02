/*
  Warnings:

  - You are about to drop the column `requesterId` on the `ContactRequest` table. All the data in the column will be lost.
  - Added the required column `buyerId` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerId` to the `ContactRequest` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ContactRequest" DROP CONSTRAINT "ContactRequest_requesterId_fkey";

-- AlterTable
ALTER TABLE "ContactRequest" DROP COLUMN "requesterId",
ADD COLUMN     "buyerId" TEXT NOT NULL,
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "sellerId" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
