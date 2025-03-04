-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'CATTLE_TRUCK', 'REFRIGERATOR_TRUCK', 'SEMI_TRAILER');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('WATER_SYSTEM', 'VENTILATION', 'TEMPERATURE_CONTROL', 'LOADING_RAMP', 'GPS_TRACKER', 'CCTV');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "companyType" TEXT;

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "vin" TEXT,
    "cattleExpYears" INTEGER NOT NULL DEFAULT 0,
    "hasCattleExp" BOOLEAN NOT NULL DEFAULT false,
    "equipment" "Equipment"[],
    "workingRegions" TEXT[],
    "sanitaryPassport" BOOLEAN NOT NULL DEFAULT false,
    "sanitaryExpDate" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
