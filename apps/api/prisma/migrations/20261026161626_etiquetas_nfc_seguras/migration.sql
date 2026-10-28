-- CreateEnum
CREATE TYPE "NfcTagKind" AS ENUM ('basic', 'secure');

-- CreateEnum
CREATE TYPE "NfcTagConfigurationStatus" AS ENUM ('none', 'incomplete', 'configured');

-- CreateEnum
CREATE TYPE "SdmResult" AS ENUM ('valid', 'invalid_signature', 'missing', 'replayed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordFlagType" ADD VALUE 'tag_not_authentic';
ALTER TYPE "RecordFlagType" ADD VALUE 'replayed_read';

-- AlterTable
ALTER TABLE "CheckpointRecord" ADD COLUMN     "sdmMessage" TEXT,
ADD COLUMN     "sdmResult" "SdmResult";

-- AlterTable
ALTER TABLE "NfcTag" ADD COLUMN     "configurationStatus" "NfcTagConfigurationStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "kind" "NfcTagKind" NOT NULL DEFAULT 'basic',
ADD COLUMN     "lastCounter" INTEGER,
ADD COLUMN     "masterKeyVersion" INTEGER;

-- CreateTable
CREATE TABLE "SecureTagSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tagUid" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "state" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecureTagSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecureTagSession_companyId_checkpointId_expiresAt_idx" ON "SecureTagSession"("companyId", "checkpointId", "expiresAt");

-- AddForeignKey
ALTER TABLE "SecureTagSession" ADD CONSTRAINT "SecureTagSession_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
