-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedById" TEXT;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_cancelRequestedById_fkey" FOREIGN KEY ("cancelRequestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
