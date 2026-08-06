/*
  Warnings:

  - The values [STRIPE,PAYPAL,SQUARE,CLOVER,WECHAT,ALIPAY,UNIONPAY] on the enum `payment_provider` will be removed. If these variants are still used in the database, this will fail.
  - The values [BASIC,STANDARD,PRO,PREMIUM] on the enum `subscription_plan` will be removed. If these variants are still used in the database, this will fail.
  - The values [TRIAL,ACTIVE,PAST_DUE,CANCELED,SUSPENDED,EXPIRED] on the enum `subscription_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "payment_provider_new" AS ENUM ('stripe', 'paypal', 'square', 'clover', 'wechat', 'alipay', 'unionpay');
ALTER TABLE "payment_integrations" ALTER COLUMN "provider" TYPE "payment_provider_new" USING ("provider"::text::"payment_provider_new");
ALTER TABLE "payment_methods" ALTER COLUMN "provider" TYPE "payment_provider_new" USING ("provider"::text::"payment_provider_new");
ALTER TABLE "payment_events" ALTER COLUMN "provider" TYPE "payment_provider_new" USING ("provider"::text::"payment_provider_new");
ALTER TABLE "invoices" ALTER COLUMN "provider" TYPE "payment_provider_new" USING ("provider"::text::"payment_provider_new");
ALTER TYPE "payment_provider" RENAME TO "payment_provider_old";
ALTER TYPE "payment_provider_new" RENAME TO "payment_provider";
DROP TYPE "payment_provider_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "subscription_plan_new" AS ENUM ('basic', 'standard', 'pro', 'premium');
ALTER TABLE "subscriptions" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "plan" TYPE "subscription_plan_new" USING ("plan"::text::"subscription_plan_new");
ALTER TABLE "subscription_history" ALTER COLUMN "old_plan" TYPE "subscription_plan_new" USING ("old_plan"::text::"subscription_plan_new");
ALTER TABLE "subscription_history" ALTER COLUMN "new_plan" TYPE "subscription_plan_new" USING ("new_plan"::text::"subscription_plan_new");
ALTER TYPE "subscription_plan" RENAME TO "subscription_plan_old";
ALTER TYPE "subscription_plan_new" RENAME TO "subscription_plan";
DROP TYPE "subscription_plan_old";
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DEFAULT 'basic';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "subscription_status_new" AS ENUM ('trial', 'active', 'past_due', 'canceled', 'suspended', 'expired');
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "subscription_status_new" USING ("status"::text::"subscription_status_new");
ALTER TABLE "subscription_history" ALTER COLUMN "old_status" TYPE "subscription_status_new" USING ("old_status"::text::"subscription_status_new");
ALTER TABLE "subscription_history" ALTER COLUMN "new_status" TYPE "subscription_status_new" USING ("new_status"::text::"subscription_status_new");
ALTER TYPE "subscription_status" RENAME TO "subscription_status_old";
ALTER TYPE "subscription_status_new" RENAME TO "subscription_status";
DROP TYPE "subscription_status_old";
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'trial';
COMMIT;

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'trial',
ALTER COLUMN "plan" SET DEFAULT 'basic';
