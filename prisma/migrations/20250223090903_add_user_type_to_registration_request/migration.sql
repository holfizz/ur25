-- CreateTable
CREATE TABLE "RegistrationRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "ogrn" TEXT NOT NULL,
    "mercuryNumber" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id")
);
