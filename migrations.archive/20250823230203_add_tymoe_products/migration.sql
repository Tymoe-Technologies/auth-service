-- CreateEnum
CREATE TYPE "TenantAppStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantApp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" "TenantAppStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_key_key" ON "Product"("key");

-- CreateIndex
CREATE INDEX "TenantApp_tenantId_idx" ON "TenantApp"("tenantId");

-- CreateIndex
CREATE INDEX "TenantApp_productKey_idx" ON "TenantApp"("productKey");

-- CreateIndex
CREATE UNIQUE INDEX "TenantApp_tenantId_productKey_key" ON "TenantApp"("tenantId", "productKey");
