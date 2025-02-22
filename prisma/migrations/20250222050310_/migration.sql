/*
  Warnings:

  - The primary key for the `matches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `matches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `messages` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `messages` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `requestId` column on the `messages` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `matchId` column on the `messages` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `requests` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `requestId` on the `matches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_requestId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_matchId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_requestId_fkey";

-- AlterTable
ALTER TABLE "matches" DROP CONSTRAINT "matches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "requestId",
ADD COLUMN     "requestId" INTEGER NOT NULL,
ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "messages" DROP CONSTRAINT "messages_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "requestId",
ADD COLUMN     "requestId" INTEGER,
DROP COLUMN "matchId",
ADD COLUMN     "matchId" INTEGER,
ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "requests" DROP CONSTRAINT "requests_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "weight" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "maxPrice" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
ADD CONSTRAINT "requests_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
