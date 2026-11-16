-- CreateEnum
CREATE TYPE "SmsInboundAuthResult" AS ENUM ('valid', 'unverified', 'unknown');

-- AlterTable
ALTER TABLE "PanicAlert" ADD COLUMN     "phoneMismatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortId" VARCHAR(8),
ADD COLUMN     "unverified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SmsInbound" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'http',
    "messageId" VARCHAR(100) NOT NULL,
    "fromOriginal" VARCHAR(40) NOT NULL,
    "fromNormalized" VARCHAR(40) NOT NULL,
    "text" VARCHAR(1600) NOT NULL,
    "gatewayReceivedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "result" "SmsInboundAuthResult" NOT NULL DEFAULT 'unknown',
    "companyId" TEXT,
    "shiftId" TEXT,
    "alertId" UUID,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SmsInbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsInbound_shiftId_idx" ON "SmsInbound"("shiftId");

-- CreateIndex
CREATE INDEX "SmsInbound_fromNormalized_idx" ON "SmsInbound"("fromNormalized");

-- CreateIndex
CREATE INDEX "SmsInbound_companyId_receivedAt_idx" ON "SmsInbound"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsInbound_provider_messageId_key" ON "SmsInbound"("provider", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "PanicAlert_shiftId_shortId_key" ON "PanicAlert"("shiftId", "shortId");

-- AddForeignKey
ALTER TABLE "SmsInbound" ADD CONSTRAINT "SmsInbound_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PanicAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
