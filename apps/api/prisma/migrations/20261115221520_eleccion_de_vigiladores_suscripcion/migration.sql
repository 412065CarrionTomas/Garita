-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "guardSelection" JSONB;

-- AlterTable
ALTER TABLE "SubscriptionCharge" ADD COLUMN     "effectsAppliedStatus" "SubscriptionChargeStatus";
