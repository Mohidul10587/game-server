BEGIN;

-- Keep each rack within the new three-shelf / two-slot layout. Any miners
-- above the six-slot limit return to inventory by removing only their placement.
WITH ranked_placements AS (
  SELECT ump."id", ump."rackPlacementId",
         ROW_NUMBER() OVER (
           PARTITION BY ump."rackPlacementId"
           ORDER BY ump."slotIndex", ump."placedAt", ump."id"
         ) AS placement_rank
  FROM "user_miner_placements" ump
  JOIN "user_rack_placements" urp ON urp."id" = ump."rackPlacementId"
  JOIN "rack_products" rp ON rp."id" = urp."rackProductId"
  WHERE rp."minerCapacity" > 6
)
DELETE FROM "user_miner_placements" ump
USING ranked_placements ranked
WHERE ump."id" = ranked."id"
  AND ranked.placement_rank > 6;

-- Compact any remaining legacy slots so all retained miners fit in 0..5.
UPDATE "user_miner_placements" ump
SET "slotIndex" = ump."slotIndex" + 10000000
FROM "user_rack_placements" urp
JOIN "rack_products" rp ON rp."id" = urp."rackProductId"
WHERE ump."rackPlacementId" = urp."id"
  AND rp."minerCapacity" > 6;

WITH ranked_placements AS (
  SELECT ump."id",
         ROW_NUMBER() OVER (
           PARTITION BY ump."rackPlacementId"
           ORDER BY ump."slotIndex", ump."placedAt", ump."id"
         ) - 1 AS new_slot_index
  FROM "user_miner_placements" ump
  JOIN "user_rack_placements" urp ON urp."id" = ump."rackPlacementId"
  JOIN "rack_products" rp ON rp."id" = urp."rackProductId"
  WHERE rp."minerCapacity" > 6
)
UPDATE "user_miner_placements" ump
SET "slotIndex" = ranked.new_slot_index
FROM ranked_placements ranked
WHERE ump."id" = ranked."id";

UPDATE "rack_products" SET "minerCapacity" = 6 WHERE "minerCapacity" > 6;
ALTER TABLE "rack_products" ALTER COLUMN "minerCapacity" SET DEFAULT 6;

COMMIT;
