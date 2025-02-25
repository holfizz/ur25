/*
  Warnings:

  - Added the required column `password` to the `RegistrationRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RegistrationRequest" ADD COLUMN     "password" TEXT NOT NULL;
