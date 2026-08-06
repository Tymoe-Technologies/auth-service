-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "email_verification_code" TEXT,
ADD COLUMN     "email_verification_code_expires_at" TIMESTAMP(3);
