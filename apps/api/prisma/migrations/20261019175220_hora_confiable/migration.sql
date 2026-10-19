-- CreateEnum
CREATE TYPE "TimeStatus" AS ENUM ('verified', 'recalculated', 'pending', 'unverifiable');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordFlagType" ADD VALUE 'time_altered';
ALTER TYPE "RecordFlagType" ADD VALUE 'time_unverifiable';

-- AlterTable
ALTER TABLE "CheckpointRecord" ADD COLUMN     "bootId" TEXT,
ADD COLUMN     "deviceOffsetMs" DOUBLE PRECISION,
ADD COLUMN     "elapsedMs" DOUBLE PRECISION,
ADD COLUMN     "timeStatus" "TimeStatus",
ADD COLUMN     "trustedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ShiftEvent" ADD COLUMN     "bootId" TEXT,
ADD COLUMN     "deviceOffsetMs" DOUBLE PRECISION,
ADD COLUMN     "elapsedMs" DOUBLE PRECISION,
ADD COLUMN     "timeStatus" "TimeStatus",
ADD COLUMN     "trustedAt" TIMESTAMPTZ(3);
