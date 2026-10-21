-- CreateTable
CREATE TABLE "IncidentPhotoAuthorization" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPhotoAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentPhotoAuthorization_cloudinaryPublicId_key" ON "IncidentPhotoAuthorization"("cloudinaryPublicId");

-- CreateIndex
CREATE INDEX "IncidentPhotoAuthorization_incidentId_expiresAt_idx" ON "IncidentPhotoAuthorization"("incidentId", "expiresAt");

-- AddForeignKey
ALTER TABLE "IncidentPhotoAuthorization" ADD CONSTRAINT "IncidentPhotoAuthorization_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
