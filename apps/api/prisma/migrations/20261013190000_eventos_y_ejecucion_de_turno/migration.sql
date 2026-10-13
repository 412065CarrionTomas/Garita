ALTER TYPE "ShiftStatus" ADD VALUE 'in_progress';
ALTER TYPE "ShiftStatus" ADD VALUE 'closed';
ALTER TYPE "ShiftStatus" ADD VALUE 'auto_closed';
CREATE TYPE "ShiftEventType" AS ENUM ('start', 'close', 'auto_close', 'admin_close');
CREATE TYPE "ShiftEventLocationStatus" AS ENUM ('ok', 'unverifiable', 'disabled');
CREATE TYPE "ShiftEventSimulation" AS ENUM ('simulated', 'not_simulated', 'unavailable');
CREATE TYPE "ShiftClosedBy" AS ENUM ('guard', 'admin', 'system');
ALTER TABLE "Shift" ADD COLUMN "startedAt" TIMESTAMPTZ(3), ADD COLUMN "lateStartMinutes" INTEGER, ADD COLUMN "closedAt" TIMESTAMPTZ(3), ADD COLUMN "closedEarly" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "closeReason" TEXT, ADD COLUMN "closedBy" "ShiftClosedBy", ADD COLUMN "closedByUserId" TEXT, ADD COLUMN "autoClosedAt" TIMESTAMPTZ(3);
CREATE TABLE "ShiftEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "type" "ShiftEventType" NOT NULL,
  "deviceEventId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locationStatus" "ShiftEventLocationStatus",
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(10,6),
  "accuracyMeters" DECIMAL(10,2),
  "simulation" "ShiftEventSimulation",
  "reason" TEXT,
  "actorUserId" TEXT,
  "lateStartMinutes" INTEGER,
  "countsForCompliance" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ShiftEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftEvent_deviceEventId_key" ON "ShiftEvent"("deviceEventId");
CREATE INDEX "ShiftEvent_companyId_shiftId_occurredAt_idx" ON "ShiftEvent"("companyId", "shiftId", "occurredAt");
CREATE INDEX "ShiftEvent_assignmentId_type_idx" ON "ShiftEvent"("assignmentId", "type");
ALTER TABLE "ShiftEvent" ADD CONSTRAINT "ShiftEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftEvent" ADD CONSTRAINT "ShiftEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
