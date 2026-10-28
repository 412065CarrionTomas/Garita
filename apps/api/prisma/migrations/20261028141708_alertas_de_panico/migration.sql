-- CreateEnum
CREATE TYPE "PanicAlertStatus" AS ENUM ('active', 'confirmed', 'resolved');

-- CreateEnum
CREATE TYPE "PanicAlertChannel" AS ENUM ('internet', 'sms');

-- CreateTable
CREATE TABLE "PanicAlert" (
    "id" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "status" "PanicAlertStatus" NOT NULL DEFAULT 'active',
    "channel" "PanicAlertChannel" NOT NULL DEFAULT 'internet',
    "triggeredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "accuracyMeters" DECIMAL(10,2),
    "locationStatus" "ShiftEventLocationStatus" NOT NULL,
    "timeStatus" "TimeStatus",
    "activationCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanicAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanicAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB,

    CONSTRAINT "PanicAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PanicAlert_companyId_status_idx" ON "PanicAlert"("companyId", "status");

-- CreateIndex
CREATE INDEX "PanicAlert_siteId_createdAt_idx" ON "PanicAlert"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "PanicAlert_shiftId_status_idx" ON "PanicAlert"("shiftId", "status");

-- CreateIndex
CREATE INDEX "PanicAlertEvent_alertId_occurredAt_idx" ON "PanicAlertEvent"("alertId", "occurredAt");

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlertEvent" ADD CONSTRAINT "PanicAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PanicAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
