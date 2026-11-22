BEGIN;

-- Remember each room's prior column count so existing racks keep their row
-- and column positions when the room expands to a 10-column layout.
CREATE TEMP TABLE "_rack_grid_expansion" ON COMMIT DROP AS
SELECT "id", "gridCols" AS "oldCols"
FROM "mining_rooms"
WHERE "gridCols" < 10;

-- Move old positions out of the way to avoid collisions with the unique
-- (roomId, slotIndex) constraint while the row-major indexes are remapped.
UPDATE "user_rack_placements" placement
SET "slotIndex" = placement."slotIndex" + 10000000
FROM "_rack_grid_expansion" room
WHERE placement."roomId" = room."id";

UPDATE "user_rack_placements" placement
SET "slotIndex" =
  ((placement."slotIndex" - 10000000) / room."oldCols") * 10
  + ((placement."slotIndex" - 10000000) % room."oldCols")
FROM "_rack_grid_expansion" room
WHERE placement."roomId" = room."id";

UPDATE "mining_rooms" room
SET "gridCols" = 10
FROM "_rack_grid_expansion" expanded
WHERE room."id" = expanded."id";

ALTER TABLE "mining_rooms"
  ALTER COLUMN "gridCols" SET DEFAULT 10;

COMMIT;
