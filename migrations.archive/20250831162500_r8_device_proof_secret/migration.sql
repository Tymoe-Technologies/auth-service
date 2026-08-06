-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "secretHash" TEXT,
    "publicJwk" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_orgId_idx" ON "Device"("orgId");

-- CreateIndex
CREATE INDEX "Device_clientId_idx" ON "Device"("clientId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");