-- CreateIndex
CREATE INDEX "CheckpointRecord_companyId_occurredAtDevice_idx" ON "CheckpointRecord"("companyId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "CheckpointRecord_companyId_checkpointId_occurredAtDevice_idx" ON "CheckpointRecord"("companyId", "checkpointId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "Notice_companyId_kind_status_createdAt_idx" ON "Notice"("companyId", "kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecordFlag_companyId_createdAt_idx" ON "RecordFlag"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "RoundWindowState_companyId_startsAt_idx" ON "RoundWindowState"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "RoundWindowState_companyId_status_startsAt_idx" ON "RoundWindowState"("companyId", "status", "startsAt");
