-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('REGULAR', 'PREMIUM', 'SUPER_PREMIUM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'REGULAR';
