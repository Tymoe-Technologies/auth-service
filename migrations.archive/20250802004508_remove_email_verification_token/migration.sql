/*
  Warnings:

  - You are about to drop the column `email_verification_token` on the `tenants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "email_verification_token";
