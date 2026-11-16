-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "graceChargeId" TEXT,
ADD COLUMN     "graceRemindersSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "SubscriptionCharge" ADD COLUMN     "graceInitPoint" TEXT,
ADD COLUMN     "gracePaidPaymentId" TEXT,
ADD COLUMN     "gracePreferenceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "gracePreferenceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_gracePaidPaymentId_key" ON "SubscriptionCharge"("gracePaidPaymentId");
