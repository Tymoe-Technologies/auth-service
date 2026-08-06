-- v0.2.8-p1: Add lastSeenAt to RefreshToken for inactivity tracking
ALTER TABLE "RefreshToken" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create index for lastSeenAt for efficient inactivity queries  
CREATE INDEX "RefreshToken_lastSeenAt_idx" ON "RefreshToken"("lastSeenAt");