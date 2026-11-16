-- CreateEnum
CREATE TYPE "ReportExportType" AS ENUM ('rounds', 'incidents', 'portal');

-- CreateEnum
CREATE TYPE "ReportExportResult" AS ENUM ('ok', 'failed');

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "siteIds" TEXT[],
    "periodStart" VARCHAR(10),
    "periodEnd" VARCHAR(10),
    "reportType" "ReportExportType" NOT NULL,
    "result" "ReportExportResult" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportExport_companyId_createdAt_idx" ON "ReportExport"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExport_userId_createdAt_idx" ON "ReportExport"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
