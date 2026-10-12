-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(10,6) NOT NULL,
    "toleranceRadiusMeters" INTEGER NOT NULL DEFAULT 30,
    "stickerLocation" TEXT,
    "isIndoor" BOOLEAN NOT NULL DEFAULT false,
    "qrVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Checkpoint_companyId_status_idx" ON "Checkpoint"("companyId", "status");

-- CreateIndex
CREATE INDEX "Checkpoint_siteId_status_idx" ON "Checkpoint"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_siteId_name_key" ON "Checkpoint"("siteId", "name");

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
