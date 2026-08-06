-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "tokenEnc" TEXT,
ADD COLUMN     "iv" TEXT,
ADD COLUMN     "tag" TEXT;

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "tokenEnc" TEXT,
ADD COLUMN     "iv" TEXT,
ADD COLUMN     "tag" TEXT;