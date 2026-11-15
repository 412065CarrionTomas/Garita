-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('trial', 'active', 'grace', 'suspended');

-- CreateEnum
CREATE TYPE "SuspensionReason" AS ENUM ('trial_expired', 'grace_expired', 'cancelled');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'trial',
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" "SuspensionReason",
ADD COLUMN     "trialRemindersSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

UPDATE "Company"
SET "trialEndsAt" = COALESCE("trialEndsAt",
  ((("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE "timezone")::date + 13 + TIME '23:59')
    AT TIME ZONE "timezone" AT TIME ZONE 'UTC'));

UPDATE "Company" AS company
SET "accountStatus" = CASE
  WHEN EXISTS (SELECT 1 FROM "Subscription" s WHERE s."companyId" = company.id AND s.status = 'authorized')
    THEN 'active'::"AccountStatus"
  WHEN company."trialEndsAt" > CURRENT_TIMESTAMP AT TIME ZONE 'UTC' THEN 'trial'::"AccountStatus"
  ELSE 'active'::"AccountStatus"
END;
-- Existing companies are never suspended by this migration.
-- The creation day counts as day 1; match shared trialEndsAt at 23:59 on day 14.
