-- CreateEnum
CREATE TYPE "CheckpointRecordMethod" AS ENUM ('qr', 'nfc');

-- CreateEnum
CREATE TYPE "PhoneNfcState" AS ENUM ('on', 'off', 'unsupported');

-- CreateEnum
CREATE TYPE "InvalidScanReason" AS ENUM ('malformed', 'signature', 'other_site', 'outdated_version', 'unknown_checkpoint', 'tag_not_associated', 'tag_replaced');

-- CreateTable
CREATE TABLE "CheckpointRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "recordId" UUID NOT NULL,
    "method" "CheckpointRecordMethod" NOT NULL,
    "occurredAtDevice" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationStatus" "ShiftEventLocationStatus" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "accuracyMeters" DECIMAL(10,2),
    "simulation" "ShiftEventSimulation" NOT NULL,
    "phoneNfc" "PhoneNfcState" NOT NULL,
    "countedFor" JSONB NOT NULL,
    "outOfWindow" BOOLEAN NOT NULL DEFAULT false,
    "countsForCompliance" BOOLEAN NOT NULL DEFAULT true,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckpointRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvalidScanAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "recordId" UUID NOT NULL,
    "method" "CheckpointRecordMethod" NOT NULL,
    "reason" "InvalidScanReason" NOT NULL,
    "scannedValue" VARCHAR(512) NOT NULL,
    "occurredAtDevice" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationStatus" "ShiftEventLocationStatus" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "accuracyMeters" DECIMAL(10,2),
    "simulation" "ShiftEventSimulation" NOT NULL,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvalidScanAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckpointRecord_recordId_key" ON "CheckpointRecord"("recordId");

-- CreateIndex
CREATE INDEX "CheckpointRecord_companyId_shiftId_occurredAtDevice_idx" ON "CheckpointRecord"("companyId", "shiftId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "CheckpointRecord_shiftId_occurredAtDevice_idx" ON "CheckpointRecord"("shiftId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "CheckpointRecord_checkpointId_occurredAtDevice_idx" ON "CheckpointRecord"("checkpointId", "occurredAtDevice");

-- CreateIndex
CREATE UNIQUE INDEX "InvalidScanAttempt_recordId_key" ON "InvalidScanAttempt"("recordId");

-- CreateIndex
CREATE INDEX "InvalidScanAttempt_companyId_shiftId_occurredAtDevice_idx" ON "InvalidScanAttempt"("companyId", "shiftId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "InvalidScanAttempt_shiftId_occurredAtDevice_idx" ON "InvalidScanAttempt"("shiftId", "occurredAtDevice");

-- AddForeignKey
ALTER TABLE "CheckpointRecord" ADD CONSTRAINT "CheckpointRecord_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointRecord" ADD CONSTRAINT "CheckpointRecord_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointRecord" ADD CONSTRAINT "CheckpointRecord_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvalidScanAttempt" ADD CONSTRAINT "InvalidScanAttempt_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvalidScanAttempt" ADD CONSTRAINT "InvalidScanAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
