-- Una empresa no puede tener más de una suscripción abierta (HU-29).
-- Prisma no soporta índices únicos parciales en el esquema, por eso vive solo acá.
CREATE UNIQUE INDEX "Subscription_one_open_per_company"
  ON "Subscription"("companyId")
  WHERE "status" IN ('pending', 'authorized', 'paused');
