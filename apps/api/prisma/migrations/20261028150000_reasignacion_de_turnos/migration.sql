CREATE TYPE "ShiftAssignmentResult" AS ENUM ('scheduled', 'started', 'absent', 'replaced', 'closed_early');

ALTER TABLE "Shift" ADD COLUMN "individuallyModified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShiftAssignment" ADD COLUMN "reassignedAt" TIMESTAMPTZ(3);
ALTER TABLE "ShiftAssignment" ADD COLUMN "resultNew" "ShiftAssignmentResult" NOT NULL DEFAULT 'scheduled';

UPDATE "ShiftAssignment" AS assignment
SET "resultNew" = CASE
  WHEN EXISTS (SELECT 1 FROM "ShiftEvent" AS event WHERE event."assignmentId" = assignment."id" AND event."type" = 'start')
    THEN CASE WHEN shift."closedEarly" AND shift."closedAt" < shift."endsAt" THEN 'closed_early'::"ShiftAssignmentResult" ELSE 'started'::"ShiftAssignmentResult" END
  ELSE 'scheduled'::"ShiftAssignmentResult"
END
FROM "Shift" AS shift
WHERE shift."id" = assignment."shiftId";

ALTER TABLE "ShiftAssignment" DROP COLUMN "result";
ALTER TABLE "ShiftAssignment" RENAME COLUMN "resultNew" TO "result";
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
