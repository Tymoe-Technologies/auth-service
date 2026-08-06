-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('MAIN', 'BRANCH', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('POS', 'KIOSK', 'TABLET', 'DISPLAY');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('signup', 'email_change', 'password_reset');

-- CreateEnum
CREATE TYPE "LoginType" AS ENUM ('USER', 'ACCOUNT', 'CONSUMER');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'GRACE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ConsumerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "avatarConfig" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "pinCodeHash" TEXT,
    "pinLookup" TEXT,
    "loginFailureCount" INTEGER NOT NULL DEFAULT 0,
    "lastLoginFailureAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentOrgId" TEXT,
    "orgName" TEXT NOT NULL,
    "orgType" "OrgType" NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "province" TEXT,
    "street" TEXT,
    "unit" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" VARCHAR(64),
    "business_hours" JSONB,
    "subdomain" TEXT,
    "customDomain" TEXT,
    "themeSettings" JSONB,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "accountCode" TEXT NOT NULL,
    "pinCodeHash" TEXT NOT NULL,
    "pinLookup" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarConfig" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "loginFailureCount" INTEGER NOT NULL DEFAULT 0,
    "lastLoginFailureAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockReason" TEXT,
    "permissionSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionSet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "deviceName" TEXT,
    "activationCode" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationCodeHash" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "sentTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "loginType" "LoginType" NOT NULL,
    "userId" TEXT,
    "accountId" TEXT,
    "loginIdentifier" TEXT NOT NULL,
    "organizationId" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceFingerprint" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "attemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumerId" TEXT,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "familyId" TEXT,
    "subjectUserId" TEXT,
    "subjectAccountId" TEXT,
    "clientId" TEXT NOT NULL,
    "organizationId" TEXT,
    "deviceId" TEXT,
    "deviceInfo" TEXT,
    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectConsumerId" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Key" (
    "kid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "KeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "privatePem" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Key_pkey" PRIMARY KEY ("kid")
);

-- CreateTable
CREATE TABLE "Consumer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "email" TEXT,
    "status" "ConsumerStatus" NOT NULL DEFAULT 'ACTIVE',
    "smsCodeHash" TEXT,
    "smsCodeExpiresAt" TIMESTAMP(3),
    "smsCodeDailyCount" INTEGER NOT NULL DEFAULT 0,
    "smsCodeCountDate" TIMESTAMP(3),
    "emailCodeHash" TEXT,
    "emailCodeExpiresAt" TIMESTAMP(3),
    "emailCodeDailyCount" INTEGER NOT NULL DEFAULT 0,
    "emailCodeCountDate" TIMESTAMP(3),
    "loginFailureCount" INTEGER NOT NULL DEFAULT 0,
    "lastLoginFailureAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consumer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedAddress" (
    "id" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "buzzer" TEXT,
    "deliveryNotes" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "actorUserId" TEXT,
    "actorAccountId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detail" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteAuthRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "reason" TEXT NOT NULL,
    "requiredPermission" TEXT,
    "createdByAccountId" TEXT NOT NULL,
    "createdByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedByEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteAuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseInvitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "parentOrgId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "proposedOrgName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdOrgId" TEXT,
    "createdAccountId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_subdomain_key" ON "Organization"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_customDomain_key" ON "Organization"("customDomain");

-- CreateIndex
CREATE INDEX "Organization_userId_idx" ON "Organization"("userId");

-- CreateIndex
CREATE INDEX "Organization_parentOrgId_idx" ON "Organization"("parentOrgId");

-- CreateIndex
CREATE INDEX "Organization_orgType_idx" ON "Organization"("orgType");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE INDEX "Account_orgId_idx" ON "Account"("orgId");

-- CreateIndex
CREATE INDEX "Account_username_idx" ON "Account"("username");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "Account_orgId_pinLookup_idx" ON "Account"("orgId", "pinLookup");

-- CreateIndex
CREATE INDEX "Account_permissionSetId_idx" ON "Account"("permissionSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_orgId_accountCode_status_key" ON "Account"("orgId", "accountCode", "status");

-- CreateIndex
CREATE INDEX "PermissionSet_orgId_idx" ON "PermissionSet"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_activationCode_key" ON "Device"("activationCode");

-- CreateIndex
CREATE INDEX "Device_orgId_idx" ON "Device"("orgId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE INDEX "Device_activationCode_idx" ON "Device"("activationCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSession_deviceId_key" ON "DeviceSession"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSession_sessionTokenHash_key" ON "DeviceSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "DeviceSession_sessionTokenHash_idx" ON "DeviceSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "DeviceSession_deviceId_idx" ON "DeviceSession"("deviceId");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_idx" ON "EmailVerification"("userId");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_userId_idx" ON "LoginAttempt"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_accountId_idx" ON "LoginAttempt"("accountId");

-- CreateIndex
CREATE INDEX "LoginAttempt_consumerId_idx" ON "LoginAttempt"("consumerId");

-- CreateIndex
CREATE INDEX "LoginAttempt_loginIdentifier_idx" ON "LoginAttempt"("loginIdentifier");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipAddress_idx" ON "LoginAttempt"("ipAddress");

-- CreateIndex
CREATE INDEX "LoginAttempt_attemptAt_idx" ON "LoginAttempt"("attemptAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_success_idx" ON "LoginAttempt"("success");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_subjectUserId_idx" ON "RefreshToken"("subjectUserId");

-- CreateIndex
CREATE INDEX "RefreshToken_subjectAccountId_idx" ON "RefreshToken"("subjectAccountId");

-- CreateIndex
CREATE INDEX "RefreshToken_subjectConsumerId_idx" ON "RefreshToken"("subjectConsumerId");

-- CreateIndex
CREATE INDEX "RefreshToken_deviceId_idx" ON "RefreshToken"("deviceId");

-- CreateIndex
CREATE INDEX "RefreshToken_status_idx" ON "RefreshToken"("status");

-- CreateIndex
CREATE INDEX "RefreshToken_lastSeenAt_idx" ON "RefreshToken"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Key_status_idx" ON "Key"("status");

-- CreateIndex
CREATE INDEX "Consumer_phone_idx" ON "Consumer"("phone");

-- CreateIndex
CREATE INDEX "Consumer_orgId_idx" ON "Consumer"("orgId");

-- CreateIndex
CREATE INDEX "Consumer_email_idx" ON "Consumer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Consumer_orgId_phone_key" ON "Consumer"("orgId", "phone");

-- CreateIndex
CREATE INDEX "SavedAddress_consumerId_idx" ON "SavedAddress"("consumerId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_actorAccountId_idx" ON "AuditLog"("actorAccountId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteAuthRequest_token_key" ON "RemoteAuthRequest"("token");

-- CreateIndex
CREATE INDEX "RemoteAuthRequest_orgId_idx" ON "RemoteAuthRequest"("orgId");

-- CreateIndex
CREATE INDEX "RemoteAuthRequest_token_idx" ON "RemoteAuthRequest"("token");

-- CreateIndex
CREATE INDEX "RemoteAuthRequest_status_idx" ON "RemoteAuthRequest"("status");

-- CreateIndex
CREATE INDEX "RemoteAuthRequest_expiresAt_idx" ON "RemoteAuthRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseInvitation_token_key" ON "FranchiseInvitation"("token");

-- CreateIndex
CREATE INDEX "FranchiseInvitation_parentOrgId_idx" ON "FranchiseInvitation"("parentOrgId");

-- CreateIndex
CREATE INDEX "FranchiseInvitation_token_idx" ON "FranchiseInvitation"("token");

-- CreateIndex
CREATE INDEX "FranchiseInvitation_email_idx" ON "FranchiseInvitation"("email");

-- CreateIndex
CREATE INDEX "FranchiseInvitation_status_idx" ON "FranchiseInvitation"("status");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_permissionSetId_fkey" FOREIGN KEY ("permissionSetId") REFERENCES "PermissionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "Consumer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_subjectAccountId_fkey" FOREIGN KEY ("subjectAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_subjectConsumerId_fkey" FOREIGN KEY ("subjectConsumerId") REFERENCES "Consumer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumer" ADD CONSTRAINT "Consumer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedAddress" ADD CONSTRAINT "SavedAddress_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "Consumer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_subject_fkey" FOREIGN KEY ("subject") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

