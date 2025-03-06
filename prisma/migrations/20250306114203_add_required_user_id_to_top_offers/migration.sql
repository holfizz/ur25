/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `TopOffer` table. All the data in the column will be lost.
  - Added the required column `userId` to the `TopOffer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TopOffer" DROP COLUMN "updatedAt",
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'REGULAR',
ALTER COLUMN "score" SET DEFAULT 0,
ALTER COLUMN "position" SET DEFAULT 0;

-- AddForeignKey
ALTER TABLE "TopOffer" ADD CONSTRAINT "TopOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
