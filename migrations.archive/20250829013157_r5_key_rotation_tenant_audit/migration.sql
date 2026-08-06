-- CreateTable
CREATE TABLE "signing_keys" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "alg" TEXT NOT NULL DEFAULT 'RS256',
    "use" TEXT NOT NULL DEFAULT 'sig',
    "privatePem" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graceUntil" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allowedAudPrefixes" TEXT[],
    "allowedScopes" TEXT[],
    "defaultAud" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userId" TEXT,
    "clientId" TEXT,
    "tenantId" TEXT,
    "event" TEXT NOT NULL,
    "meta" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_keys_kid_key" ON "signing_keys"("kid");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_clients_clientId_tenantId_key" ON "tenant_clients"("clientId", "tenantId");

-- AddForeignKey
ALTER TABLE "tenant_clients" ADD CONSTRAINT "tenant_clients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
