BEGIN;

-- Replace the old placeholder path with the actual rack assets already in the
-- client bundle. Preserve any custom image URLs configured by an admin.
UPDATE "rack_products"
SET "imageUrl" = CASE "rackType"
  WHEN 'standard' THEN '/assets/racks/green_scanner_rack.gif'
  WHEN 'pro' THEN '/assets/racks/cyberpunk_rack.gif'
  ELSE '/assets/racks/basic_rack.gif'
END
WHERE "imageUrl" = '/assets/racks/rack-basic.svg';

ALTER TABLE "rack_products"
  ALTER COLUMN "imageUrl" SET DEFAULT '/assets/racks/basic_rack.gif';

-- A rack has four shelves, represented by miner slot indexes 0 through 3.
-- Extra placements are removed, which returns the miner to the user's storage
-- because the miner inventory row itself is retained.
WITH ranked_placements AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "rackPlacementId"
           ORDER BY "slotIndex", "placedAt", "id"
         ) AS placement_rank
  FROM "user_miner_placements"
)
DELETE FROM "user_miner_placements" placement
USING ranked_placements ranked
WHERE placement."id" = ranked."id"
  AND ranked.placement_rank > 4;

-- Move retained slots out of the unique-index range before compacting them.
UPDATE "user_miner_placements"
SET "slotIndex" = "slotIndex" + 10000000;

WITH ranked_placements AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "rackPlacementId"
           ORDER BY "slotIndex", "placedAt", "id"
         ) - 1 AS new_slot_index
  FROM "user_miner_placements"
)
UPDATE "user_miner_placements" placement
SET "slotIndex" = ranked.new_slot_index
FROM ranked_placements ranked
WHERE placement."id" = ranked."id";

COMMIT;
