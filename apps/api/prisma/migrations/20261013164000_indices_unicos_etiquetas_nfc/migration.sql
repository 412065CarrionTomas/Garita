-- PostgreSQL partial indexes enforce one active tag per checkpoint and one active
-- checkpoint per factory UID platform-wide while preserving the replacement history.
CREATE UNIQUE INDEX "NfcTag_one_active_per_checkpoint"
ON "NfcTag" ("checkpointId") WHERE "status" = 'active';

CREATE UNIQUE INDEX "NfcTag_one_active_per_uid"
ON "NfcTag" ("uid") WHERE "status" = 'active';
