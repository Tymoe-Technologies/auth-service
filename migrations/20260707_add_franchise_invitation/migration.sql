CREATE TABLE "FranchiseInvitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "parentOrgId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "proposedOrgName" TEXT,
    "productType" "ProductType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdOrgId" TEXT,
    "createdAccountId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FranchiseInvitation_token_key" ON "FranchiseInvitation"("token");

CREATE INDEX "FranchiseInvitation_parentOrgId_idx" ON "FranchiseInvitation"("parentOrgId");

CREATE INDEX "FranchiseInvitation_token_idx" ON "FranchiseInvitation"("token");

CREATE INDEX "FranchiseInvitation_email_idx" ON "FranchiseInvitation"("email");

CREATE INDEX "FranchiseInvitation_status_idx" ON "FranchiseInvitation"("status");
