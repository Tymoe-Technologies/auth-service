/*
  Warnings:

  - The primary key for the `sessions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `deleted_at` on the `sessions` table. All the data in the column will be lost.
  - You are about to drop the column `token_hash` on the `sessions` table. All the data in the column will be lost.
  - The primary key for the `tenants` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `password_reset_expires_at` on the `tenants` table. All the data in the column will be lost.
  - You are about to drop the column `password_reset_token` on the `tenants` table. All the data in the column will be lost.
  - You are about to drop the `invoices` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payment_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payment_integrations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `payment_methods` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `subscription_history` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `subscriptions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `token_blacklist` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[token_jti]` on the table `sessions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `token_jti` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_payment_integration_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_payment_integration_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_payment_method_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_integrations" DROP CONSTRAINT "payment_integrations_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_integrations" DROP CONSTRAINT "payment_integrations_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_history" DROP CONSTRAINT "subscription_history_payment_event_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_history" DROP CONSTRAINT "subscription_history_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_history" DROP CONSTRAINT "subscription_history_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tenant_id_fkey";

-- DropIndex
DROP INDEX "sessions_created_at_idx";

-- DropIndex
DROP INDEX "sessions_deleted_at_idx";

-- DropIndex
DROP INDEX "sessions_expires_at_idx";

-- DropIndex
DROP INDEX "sessions_token_hash_idx";

-- DropIndex
DROP INDEX "sessions_token_hash_key";

-- DropIndex
DROP INDEX "tenants_created_at_idx";

-- DropIndex
DROP INDEX "tenants_email_idx";

-- DropIndex
DROP INDEX "tenants_phone_idx";

-- DropIndex
DROP INDEX "tenants_subdomain_idx";

-- AlterTable
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_pkey",
DROP COLUMN "deleted_at",
DROP COLUMN "token_hash",
ADD COLUMN     "device_type" TEXT,
ADD COLUMN     "token_jti" TEXT NOT NULL,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "tenant_id" SET DATA TYPE TEXT,
ALTER COLUMN "refresh_token" SET DATA TYPE TEXT,
ALTER COLUMN "ip_address" SET DATA TYPE TEXT,
ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_pkey",
DROP COLUMN "password_reset_expires_at",
DROP COLUMN "password_reset_token",
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "email" SET DATA TYPE TEXT,
ALTER COLUMN "password_hash" SET DATA TYPE TEXT,
ALTER COLUMN "store_name" SET DATA TYPE TEXT,
ALTER COLUMN "subdomain" SET DATA TYPE TEXT,
ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "phone" SET DATA TYPE TEXT,
ALTER COLUMN "address" SET DATA TYPE TEXT,
ALTER COLUMN "email_verification_token" SET DATA TYPE TEXT,
ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "invoices";

-- DropTable
DROP TABLE "payment_events";

-- DropTable
DROP TABLE "payment_integrations";

-- DropTable
DROP TABLE "payment_methods";

-- DropTable
DROP TABLE "subscription_history";

-- DropTable
DROP TABLE "subscriptions";

-- DropTable
DROP TABLE "token_blacklist";

-- DropEnum
DROP TYPE "payment_provider";

-- DropEnum
DROP TYPE "subscription_plan";

-- DropEnum
DROP TYPE "subscription_status";

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reset_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_reset_token_key" ON "password_reset_tokens"("reset_token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_email_idx" ON "password_reset_tokens"("email");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_jti_key" ON "sessions"("token_jti");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
