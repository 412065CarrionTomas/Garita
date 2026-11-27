-- CreateTable
CREATE TABLE "UserViewPreference" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserViewPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserViewPreference_companyId_idx" ON "UserViewPreference"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "UserViewPreference_userId_viewKey_key" ON "UserViewPreference"("userId", "viewKey");

-- CreateIndex
CREATE INDEX "UserFavorite_userId_viewKey_entityType_position_idx" ON "UserFavorite"("userId", "viewKey", "entityType", "position");

-- CreateIndex
CREATE INDEX "UserFavorite_companyId_idx" ON "UserFavorite"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavorite_userId_viewKey_entityType_entityId_key" ON "UserFavorite"("userId", "viewKey", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "UserViewPreference" ADD CONSTRAINT "UserViewPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserViewPreference" ADD CONSTRAINT "UserViewPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
