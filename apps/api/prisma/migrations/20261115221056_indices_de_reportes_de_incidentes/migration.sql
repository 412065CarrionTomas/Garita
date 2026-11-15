-- CreateIndex
CREATE INDEX "Incident_companyId_trustedAt_idx" ON "Incident"("companyId", "trustedAt");

-- CreateIndex
CREATE INDEX "Incident_companyId_occurredAtDevice_idx" ON "Incident"("companyId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "Incident_companyId_receivedAt_idx" ON "Incident"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "Notice_companyId_kind_createdAt_idx" ON "Notice"("companyId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "PanicAlert_companyId_triggeredAt_idx" ON "PanicAlert"("companyId", "triggeredAt");
