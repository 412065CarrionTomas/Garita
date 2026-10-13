-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundVersion" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "frequencyMinutes" INTEGER NOT NULL,
    "windowStartLocal" TEXT NOT NULL,
    "windowEndLocal" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundVersionCheckpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roundVersionId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RoundVersionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Round_currentVersionId_key" ON "Round"("currentVersionId");

-- CreateIndex
CREATE INDEX "Round_companyId_status_idx" ON "Round"("companyId", "status");

-- CreateIndex
CREATE INDEX "Round_siteId_status_idx" ON "Round"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Round_siteId_name_key" ON "Round"("siteId", "name");

-- CreateIndex
CREATE INDEX "RoundVersion_roundId_createdAt_idx" ON "RoundVersion"("roundId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoundVersion_roundId_versionNumber_key" ON "RoundVersion"("roundId", "versionNumber");

-- CreateIndex
CREATE INDEX "RoundVersionCheckpoint_checkpointId_idx" ON "RoundVersionCheckpoint"("checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundVersionCheckpoint_roundVersionId_checkpointId_key" ON "RoundVersionCheckpoint"("roundVersionId", "checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundVersionCheckpoint_roundVersionId_position_key" ON "RoundVersionCheckpoint"("roundVersionId", "position");

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "RoundVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundVersion" ADD CONSTRAINT "RoundVersion_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundVersionCheckpoint" ADD CONSTRAINT "RoundVersionCheckpoint_roundVersionId_fkey" FOREIGN KEY ("roundVersionId") REFERENCES "RoundVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundVersionCheckpoint" ADD CONSTRAINT "RoundVersionCheckpoint_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
