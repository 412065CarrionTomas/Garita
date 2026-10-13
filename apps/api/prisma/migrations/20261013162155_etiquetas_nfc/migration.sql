-- CreateEnum
CREATE TYPE "NfcTagStatus" AS ENUM ('active', 'replaced', 'removed');

-- CreateTable
CREATE TABLE "NfcTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "status" "NfcTagStatus" NOT NULL DEFAULT 'active',
    "associatedById" TEXT NOT NULL,
    "associatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfcTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NfcTag_companyId_checkpointId_status_idx" ON "NfcTag"("companyId", "checkpointId", "status");

-- CreateIndex
CREATE INDEX "NfcTag_uid_status_idx" ON "NfcTag"("uid", "status");

-- AddForeignKey
ALTER TABLE "NfcTag" ADD CONSTRAINT "NfcTag_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
