-- CreateTable
CREATE TABLE "AuthorizationCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "codeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizationCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "AuthorizationCode_userId_idx" ON "AuthorizationCode"("userId");

-- CreateIndex
CREATE INDEX "AuthorizationCode_clientId_idx" ON "AuthorizationCode"("clientId");

-- CreateIndex
CREATE INDEX "AuthorizationCode_expiresAt_idx" ON "AuthorizationCode"("expiresAt");
