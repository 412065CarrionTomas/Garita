DROP INDEX "Checkpoint_siteId_name_key";
CREATE UNIQUE INDEX "Checkpoint_siteId_name_active_key" ON "Checkpoint" ("siteId", "name") WHERE "status" = 'active';
