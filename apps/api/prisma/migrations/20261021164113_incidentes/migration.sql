-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('intrusion', 'suspicious_person', 'suspicious_vehicle', 'property_damage', 'open_or_forced_access', 'utility_failure', 'accident', 'other');

-- CreateEnum
CREATE TYPE "IncidentClassificationStatus" AS ENUM ('pending', 'client_visible', 'internal');

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "description" VARCHAR(1000),
    "occurredAtDevice" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trustedAt" TIMESTAMPTZ(3),
    "elapsedMs" DOUBLE PRECISION,
    "bootId" TEXT,
    "timeStatus" "TimeStatus",
    "deviceOffsetMs" DOUBLE PRECISION,
    "locationStatus" "ShiftEventLocationStatus" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "accuracyMeters" DECIMAL(10,2),
    "simulation" "ShiftEventSimulation" NOT NULL,
    "countsForCompliance" BOOLEAN NOT NULL DEFAULT true,
    "classificationStatus" "IncidentClassificationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPhoto" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Incident_incidentId_key" ON "Incident"("incidentId");

-- CreateIndex
CREATE INDEX "Incident_companyId_siteId_createdAt_idx" ON "Incident"("companyId", "siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_shiftId_occurredAtDevice_idx" ON "Incident"("shiftId", "occurredAtDevice");

-- CreateIndex
CREATE INDEX "Incident_assignmentId_idx" ON "Incident"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentPhoto_cloudinaryPublicId_key" ON "IncidentPhoto"("cloudinaryPublicId");

-- CreateIndex
CREATE INDEX "IncidentPhoto_incidentId_uploadedAt_idx" ON "IncidentPhoto"("incidentId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPhoto" ADD CONSTRAINT "IncidentPhoto_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
