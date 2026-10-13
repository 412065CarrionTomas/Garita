-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('scheduled', 'unassigned', 'cancelled');

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "serviceDate" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'scheduled',
    "createdById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guardId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "result" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRound" (
    "shiftId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "roundVersionId" TEXT,

    CONSTRAINT "ShiftRound_pkey" PRIMARY KEY ("shiftId","roundId")
);

-- CreateIndex
CREATE INDEX "Shift_companyId_startsAt_idx" ON "Shift"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_siteId_serviceDate_idx" ON "Shift"("siteId", "serviceDate");

-- CreateIndex
CREATE INDEX "Shift_status_startsAt_idx" ON "Shift"("status", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftAssignment_shiftId_isCurrent_idx" ON "ShiftAssignment"("shiftId", "isCurrent");

-- CreateIndex
CREATE INDEX "ShiftAssignment_guardId_startsAt_endsAt_idx" ON "ShiftAssignment"("guardId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ShiftRound_roundId_idx" ON "ShiftRound"("roundId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRound" ADD CONSTRAINT "ShiftRound_roundVersionId_fkey" FOREIGN KEY ("roundVersionId") REFERENCES "RoundVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
