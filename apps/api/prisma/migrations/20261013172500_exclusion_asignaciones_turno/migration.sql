CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ShiftAssignment"
  ALTER COLUMN "startsAt" TYPE timestamptz(3) USING "startsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "endsAt" TYPE timestamptz(3) USING "endsAt" AT TIME ZONE 'UTC';

ALTER TABLE "Shift"
  ALTER COLUMN "startsAt" TYPE timestamptz(3) USING "startsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "endsAt" TYPE timestamptz(3) USING "endsAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "cancelledAt" TYPE timestamptz(3) USING "cancelledAt" AT TIME ZONE 'UTC';

ALTER TABLE "ShiftAssignment"
  ADD CONSTRAINT "ShiftAssignment_no_overlap_active_guard"
  EXCLUDE USING gist (
    "guardId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("guardId" IS NOT NULL AND "active" = true);