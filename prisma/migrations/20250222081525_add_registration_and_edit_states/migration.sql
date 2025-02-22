-- CreateTable
CREATE TABLE "registration_states" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "role" "Role",

    CONSTRAINT "registration_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edit_states" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "field" TEXT NOT NULL,

    CONSTRAINT "edit_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_states_telegramId_key" ON "registration_states"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "edit_states_telegramId_key" ON "edit_states"("telegramId");
