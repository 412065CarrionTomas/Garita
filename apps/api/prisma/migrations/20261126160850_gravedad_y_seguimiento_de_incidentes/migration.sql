-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "IncidentFollowUpStatus" AS ENUM ('none', 'open', 'closed');

-- CreateEnum
CREATE TYPE "IncidentFollowUpActionKind" AS ENUM ('note', 'close', 'reopen');

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "followUpClosedAt" TIMESTAMPTZ(3),
ADD COLUMN     "followUpStatus" "IncidentFollowUpStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "severity" "IncidentSeverity";

-- AlterTable
ALTER TABLE "IncidentClassification" ADD COLUMN     "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "severity" "IncidentSeverity";

-- CreateTable
CREATE TABLE "IncidentFollowUpAction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "IncidentFollowUpActionKind" NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentFollowUpAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentFollowUpAction_incidentId_createdAt_idx" ON "IncidentFollowUpAction"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_companyId_followUpStatus_idx" ON "Incident"("companyId", "followUpStatus");

-- AddForeignKey
ALTER TABLE "IncidentFollowUpAction" ADD CONSTRAINT "IncidentFollowUpAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentFollowUpAction" ADD CONSTRAINT "IncidentFollowUpAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentFollowUpAction" ADD CONSTRAINT "IncidentFollowUpAction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: los incidentes ya clasificados quedan con gravedad media.
UPDATE "Incident" SET "severity" = 'medium' WHERE "classificationStatus" <> 'pending' AND "severity" IS NULL;
UPDATE "IncidentClassification" SET "severity" = 'medium' WHERE "severity" IS NULL;
