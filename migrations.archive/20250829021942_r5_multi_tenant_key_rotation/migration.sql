/*
  Warnings:

  - The primary key for the `AuthorizationCode` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `code` on the `AuthorizationCode` table. All the data in the column will be lost.
  - You are about to drop the column `codeMethod` on the `AuthorizationCode` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `AuthorizationCode` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `RefreshToken` table. All the data in the column will be lost.
  - You are about to drop the column `prevId` on the `RefreshToken` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `RefreshToken` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `audit_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `signing_keys` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tenant_clients` table. If the table is not empty, all the data it contains will be lost.
  - The required column `id` was added to the `AuthorizationCode` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `password` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "tenant_clients" DROP CONSTRAINT "tenant_clients_clientId_fkey";

-- DropIndex
DROP INDEX "AuthorizationCode_userId_idx";

-- DropIndex
DROP INDEX "RefreshToken_deviceId_idx";

-- DropIndex
DROP INDEX "RefreshToken_userId_idx";

-- AlterTable
ALTER TABLE "AuthorizationCode" DROP CONSTRAINT "AuthorizationCode_pkey",
DROP COLUMN "code",
DROP COLUMN "codeMethod",
DROP COLUMN "userId",
ADD COLUMN     "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "nonce" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "subjectUserId" TEXT,
ADD COLUMN     "tenantId" TEXT,
ADD COLUMN     "used" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "AuthorizationCode_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "RefreshToken" DROP COLUMN "deviceId",
DROP COLUMN "prevId",
DROP COLUMN "userId",
ADD COLUMN     "subjectDeviceId" TEXT,
ADD COLUMN     "subjectUserId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash",
ADD COLUMN     "password" TEXT NOT NULL;

-- DropTable
DROP TABLE "audit_logs";

-- DropTable
DROP TABLE "signing_keys";

-- DropTable
DROP TABLE "tenant_clients";

-- CreateTable
CREATE TABLE "Key" (
    "kid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "privatePem" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Key_pkey" PRIMARY KEY ("kid")
);

-- CreateTable
CREATE TABLE "TenantClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allowedAudPrefixes" TEXT[],
    "allowedScopes" TEXT[],
    "defaultAud" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detail" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantClient_clientId_tenantId_key" ON "TenantClient"("clientId", "tenantId");

-- CreateIndex
CREATE INDEX "AuthorizationCode_subjectUserId_idx" ON "AuthorizationCode"("subjectUserId");

-- CreateIndex
CREATE INDEX "RefreshToken_subjectUserId_idx" ON "RefreshToken"("subjectUserId");
