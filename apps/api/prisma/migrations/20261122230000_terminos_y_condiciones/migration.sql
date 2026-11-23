-- AlterTable
ALTER TABLE "User" ADD COLUMN     "legalAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "legalAcceptedIp" TEXT,
ADD COLUMN     "legalVersion" TEXT;
