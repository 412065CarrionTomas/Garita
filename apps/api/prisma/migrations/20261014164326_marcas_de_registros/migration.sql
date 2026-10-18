-- CreateEnum
CREATE TYPE "SpeedProfile" AS ENUM ('walking', 'bicycle', 'vehicle', 'custom');

-- CreateEnum
CREATE TYPE "RecordFlagType" AS ENUM ('out_of_range', 'simulated_location', 'impossible_time', 'location_disabled', 'qr_on_tagged_point', 'location_unverifiable');

-- CreateEnum
CREATE TYPE "RecordFlagSeverity" AS ENUM ('grave', 'media', 'leve');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "maxSpeedKmh" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxSpeedProfile" "SpeedProfile" NOT NULL DEFAULT 'walking';

-- CreateTable
CREATE TABLE "RecordFlag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checkpointRecordId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "RecordFlagType" NOT NULL,
    "severity" "RecordFlagSeverity" NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordFlag_companyId_shiftId_createdAt_idx" ON "RecordFlag"("companyId", "shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordFlag_shiftId_createdAt_idx" ON "RecordFlag"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordFlag_checkpointRecordId_idx" ON "RecordFlag"("checkpointRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordFlag_checkpointRecordId_type_key" ON "RecordFlag"("checkpointRecordId", "type");

-- AddForeignKey
ALTER TABLE "RecordFlag" ADD CONSTRAINT "RecordFlag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFlag" ADD CONSTRAINT "RecordFlag_checkpointRecordId_fkey" FOREIGN KEY ("checkpointRecordId") REFERENCES "CheckpointRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFlag" ADD CONSTRAINT "RecordFlag_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
