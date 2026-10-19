-- CreateEnum
CREATE TYPE "ConnectivityType" AS ENUM ('with_signal', 'without_signal');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "connectivityType" "ConnectivityType",
ADD COLUMN     "marginMinutes" INTEGER,
ADD COLUMN     "minutesToSignal" INTEGER,
ADD COLUMN     "syncDeadlineAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "connectivityType" "ConnectivityType" NOT NULL DEFAULT 'with_signal',
ADD COLUMN     "marginMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "minutesToSignal" INTEGER NOT NULL DEFAULT 0;
