-- AlterTable
ALTER TABLE "Checkpoint" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Los puntos existentes se numeran como se veían hasta ahora: por nombre, dentro de cada predio.
UPDATE "Checkpoint" AS c
SET "position" = n.position
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "siteId" ORDER BY "name") AS position
  FROM "Checkpoint"
) AS n
WHERE c."id" = n."id";
