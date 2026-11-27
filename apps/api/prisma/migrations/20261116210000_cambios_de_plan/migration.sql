-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('upgrade', 'downgrade_scheduled', 'downgrade_applied', 'cancellation', 'cancellation_reverted');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pendingGuardSelection" JSONB,
ADD COLUMN     "pendingPlanAdminId" TEXT,
ADD COLUMN     "pendingPlanAt" TIMESTAMP(3),
ADD COLUMN     "pendingPlanId" TEXT;

-- CreateTable
CREATE TABLE "PlanChangePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "previousPlanId" TEXT NOT NULL,
    "newPlanId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "remainingDays" INTEGER NOT NULL,
    "cycleDays" INTEGER NOT NULL,
    "mpPreferenceId" TEXT,
    "mpPaymentId" TEXT,
    "status" "SubscriptionChargeStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "amountUpdatePending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanChangePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "SubscriptionChangeType" NOT NULL,
    "planId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanChangePayment_mpPreferenceId_key" ON "PlanChangePayment"("mpPreferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanChangePayment_mpPaymentId_key" ON "PlanChangePayment"("mpPaymentId");

-- CreateIndex
CREATE INDEX "PlanChangePayment_companyId_idx" ON "PlanChangePayment"("companyId");

-- CreateIndex
CREATE INDEX "PlanChangePayment_subscriptionId_idx" ON "PlanChangePayment"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionChange_companyId_idx" ON "SubscriptionChange"("companyId");

-- CreateIndex
CREATE INDEX "SubscriptionChange_subscriptionId_createdAt_idx" ON "SubscriptionChange"("subscriptionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangePayment" ADD CONSTRAINT "PlanChangePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangePayment" ADD CONSTRAINT "PlanChangePayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangePayment" ADD CONSTRAINT "PlanChangePayment_previousPlanId_fkey" FOREIGN KEY ("previousPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangePayment" ADD CONSTRAINT "PlanChangePayment_newPlanId_fkey" FOREIGN KEY ("newPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangePayment" ADD CONSTRAINT "PlanChangePayment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PlanChangePayment_one_pending_per_subscription" ON "PlanChangePayment" ("subscriptionId") WHERE "status" = 'pending';
