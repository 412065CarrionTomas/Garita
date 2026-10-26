-- CreateEnum
CREATE TYPE "RoundReviewDecisionKind" AS ENUM ('validate', 'invalidate', 'restore');

-- AlterTable
ALTER TABLE "CheckpointRecord" ADD COLUMN     "invalidatedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RoundWindowState" ADD COLUMN     "inReviewSince" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "RoundReviewDecision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "windowStateId" TEXT NOT NULL,
    "kind" "RoundReviewDecisionKind" NOT NULL,
    "checkpointRecordId" TEXT,
    "comment" VARCHAR(500) NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundReviewDecision_companyId_windowStateId_decidedAt_idx" ON "RoundReviewDecision"("companyId", "windowStateId", "decidedAt");

-- CreateIndex
CREATE INDEX "RoundReviewDecision_companyId_decidedAt_idx" ON "RoundReviewDecision"("companyId", "decidedAt");

-- CreateIndex
CREATE INDEX "RoundReviewDecision_checkpointRecordId_decidedAt_idx" ON "RoundReviewDecision"("checkpointRecordId", "decidedAt");

-- AddForeignKey
ALTER TABLE "RoundReviewDecision" ADD CONSTRAINT "RoundReviewDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundReviewDecision" ADD CONSTRAINT "RoundReviewDecision_windowStateId_fkey" FOREIGN KEY ("windowStateId") REFERENCES "RoundWindowState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundReviewDecision" ADD CONSTRAINT "RoundReviewDecision_checkpointRecordId_fkey" FOREIGN KEY ("checkpointRecordId") REFERENCES "CheckpointRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundReviewDecision" ADD CONSTRAINT "RoundReviewDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
