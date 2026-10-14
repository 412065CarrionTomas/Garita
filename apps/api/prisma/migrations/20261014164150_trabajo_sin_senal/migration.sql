-- CreateTable
CREATE TABLE "ShiftCredential" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "syncedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "sentAtDevice" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingCount" INTEGER NOT NULL,
    "syncedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSyncState" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "lastContactAt" TIMESTAMPTZ(3) NOT NULL,
    "lastPendingCount" INTEGER NOT NULL,
    "syncedUntil" TIMESTAMPTZ(3),
    "lastBatchAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCredential_tokenHash_key" ON "ShiftCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "ShiftCredential_companyId_shiftId_idx" ON "ShiftCredential"("companyId", "shiftId");

-- CreateIndex
CREATE INDEX "ShiftCredential_shiftId_idx" ON "ShiftCredential"("shiftId");

-- CreateIndex
CREATE INDEX "SyncBatch_companyId_shiftId_receivedAt_idx" ON "SyncBatch"("companyId", "shiftId", "receivedAt");

-- CreateIndex
CREATE INDEX "SyncBatch_shiftId_receivedAt_idx" ON "SyncBatch"("shiftId", "receivedAt");

-- CreateIndex
CREATE INDEX "ConnectionNotice_companyId_shiftId_receivedAt_idx" ON "ConnectionNotice"("companyId", "shiftId", "receivedAt");

-- CreateIndex
CREATE INDEX "ConnectionNotice_shiftId_receivedAt_idx" ON "ConnectionNotice"("shiftId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftSyncState_shiftId_key" ON "ShiftSyncState"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftSyncState_companyId_shiftId_idx" ON "ShiftSyncState"("companyId", "shiftId");

-- AddForeignKey
ALTER TABLE "ShiftCredential" ADD CONSTRAINT "ShiftCredential_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCredential" ADD CONSTRAINT "ShiftCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionNotice" ADD CONSTRAINT "ConnectionNotice_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSyncState" ADD CONSTRAINT "ShiftSyncState_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
