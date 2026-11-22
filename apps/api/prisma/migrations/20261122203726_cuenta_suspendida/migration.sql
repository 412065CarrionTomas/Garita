-- AlterEnum
ALTER TYPE "ShiftStatus" ADD VALUE 'cancelled_by_suspension';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "suspensionEffectsPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "suspensionPausedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionPlanId" TEXT;
