-- CreateTable
CREATE TABLE "IncidentClassification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "classification" "IncidentClassificationStatus" NOT NULL,
    "internalComment" VARCHAR(1000) NOT NULL,
    "clientNote" VARCHAR(500),
    "reason" VARCHAR(500),
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentClassification_companyId_incidentId_decidedAt_idx" ON "IncidentClassification"("companyId", "incidentId", "decidedAt");

-- CreateIndex
CREATE INDEX "Incident_companyId_classificationStatus_createdAt_idx" ON "Incident"("companyId", "classificationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_companyId_siteId_classificationStatus_createdAt_idx" ON "Incident"("companyId", "siteId", "classificationStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "IncidentClassification" ADD CONSTRAINT "IncidentClassification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentClassification" ADD CONSTRAINT "IncidentClassification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentClassification" ADD CONSTRAINT "IncidentClassification_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
