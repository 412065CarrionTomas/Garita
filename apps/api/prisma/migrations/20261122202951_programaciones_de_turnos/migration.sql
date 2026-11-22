-- CreateEnum
CREATE TYPE "ShiftScheduleStatus" AS ENUM ('active', 'finished', 'cancelled');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "ShiftSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "roundIds" TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ShiftScheduleStatus" NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftSchedule_companyId_status_idx" ON "ShiftSchedule"("companyId", "status");

-- CreateIndex
CREATE INDEX "Shift_scheduleId_idx" ON "Shift"("scheduleId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ShiftSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
