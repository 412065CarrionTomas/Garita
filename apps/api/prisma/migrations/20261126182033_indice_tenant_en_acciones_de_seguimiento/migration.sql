-- DropIndex
DROP INDEX "IncidentFollowUpAction_incidentId_createdAt_idx";

-- CreateIndex
CREATE INDEX "IncidentFollowUpAction_companyId_incidentId_createdAt_idx" ON "IncidentFollowUpAction"("companyId", "incidentId", "createdAt");
