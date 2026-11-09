-- CreateEnum
CREATE TYPE "PanicOutcome" AS ENUM ('real_emergency', 'false_alarm', 'test');

-- CreateEnum
CREATE TYPE "PanicSmsReason" AS ENUM ('initial', 'escalation');

-- CreateEnum
CREATE TYPE "PanicSmsDeliveryStatus" AS ENUM ('accepted', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "PanicAlert" ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "outcome" "PanicOutcome",
ADD COLUMN     "resolutionComment" VARCHAR(1000),
ADD COLUMN     "resolvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "resolvedById" TEXT;

-- CreateTable
CREATE TABLE "PanicSmsDelivery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alertId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" "PanicSmsReason" NOT NULL,
    "status" "PanicSmsDeliveryStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanicSmsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PanicSmsDelivery_alertId_idx" ON "PanicSmsDelivery"("alertId");

-- CreateIndex
CREATE INDEX "PanicSmsDelivery_companyId_createdAt_idx" ON "PanicSmsDelivery"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PanicSmsDelivery_alertId_userId_reason_key" ON "PanicSmsDelivery"("alertId", "userId", "reason");

-- CreateIndex
CREATE INDEX "PanicAlert_companyId_receivedAt_idx" ON "PanicAlert"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "PanicAlert_siteId_status_idx" ON "PanicAlert"("siteId", "status");

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicAlert" ADD CONSTRAINT "PanicAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicSmsDelivery" ADD CONSTRAINT "PanicSmsDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicSmsDelivery" ADD CONSTRAINT "PanicSmsDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PanicAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicSmsDelivery" ADD CONSTRAINT "PanicSmsDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
