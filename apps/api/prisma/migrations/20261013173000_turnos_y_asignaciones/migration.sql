-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('scheduled', 'unassigned', 'cancelled');

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "serviceDate" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'scheduled',
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guardId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "result" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftRound" (
    "shiftId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "roundVersionId" TEXT,
    CONSTRAINT "ShiftRound_pkey" PRIMARY KEY ("shiftId", "roundId")
);

CREATE INDEX "Shift_companyId_startsAt_idx" ON "Shift"("companyId", "startsAt");
CREATE INDEX "Shift_siteId_serviceDate_idx" ON "Shift"("siteId", "serviceDate");
CREATE INDEX "Shift_status_startsAt_idx" ON "Shift"("status", "startsAt");
CREATE INDEX "ShiftAssignment_shiftId_isCurrent_idx" ON "ShiftAssignment"("shiftId", "isCurrent");
CREATE INDEX "ShiftAssignment_guardId_startsAt_endsAt_idx" ON "ShiftAssignment"("guardId", "startsAt", "endsAt");
CREATE INDEX "ShiftRound_roundId_idx" ON "ShiftRound"("roundId");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_roundVersionId_fkey" FOREIGN KEY ("roundVersionId") REFERENCES "RoundVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "ShiftAssignment"
  ADD CONSTRAINT "ShiftAssignment_no_overlap_active_guard"
  EXCLUDE USING gist (
    "guardId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("guardId" IS NOT NULL AND "active" = true);
