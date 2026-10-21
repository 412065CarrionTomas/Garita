-- CreateEnum
CREATE TYPE "RoundWindowStatus" AS ENUM ('pending', 'in_progress', 'late', 'complete', 'complete_late', 'incomplete', 'not_done', 'pending_sync', 'in_review');

-- CreateEnum
CREATE TYPE "RoundWindowSeverityLevel" AS ENUM ('grave', 'media', 'leve');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShiftStatus" ADD VALUE 'uncovered';
ALTER TYPE "ShiftStatus" ADD VALUE 'no_show';

-- CreateTable
CREATE TABLE "RoundWindowState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "windowIndex" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "graceEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "RoundWindowStatus" NOT NULL DEFAULT 'pending',
    "severityLevel" "RoundWindowSeverityLevel",
    "recordedCount" INTEGER NOT NULL DEFAULT 0,
    "expectedCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundWindowState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundWindowState_companyId_shiftId_startsAt_idx" ON "RoundWindowState"("companyId", "shiftId", "startsAt");

-- CreateIndex
CREATE INDEX "RoundWindowState_shiftId_status_endsAt_idx" ON "RoundWindowState"("shiftId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoundWindowState_shiftId_roundId_windowIndex_key" ON "RoundWindowState"("shiftId", "roundId", "windowIndex");

-- AddForeignKey
ALTER TABLE "RoundWindowState" ADD CONSTRAINT "RoundWindowState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundWindowState" ADD CONSTRAINT "RoundWindowState_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundWindowState" ADD CONSTRAINT "RoundWindowState_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
