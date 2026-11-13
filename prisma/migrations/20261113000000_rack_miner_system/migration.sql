-- ============================================================
-- Migration: 20261113000000_rack_miner_system
-- Production-safe, additive migration.
-- NO existing tables are dropped or renamed.
-- NO existing columns are removed.
-- ============================================================

-- ─────────────────────────────────────────
-- STEP 1: Extend miners table
-- Add miningPower + minerType columns (additive)
-- ─────────────────────────────────────────
ALTER TABLE "miners" ADD COLUMN IF NOT EXISTS "miningPower" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "miners" ADD COLUMN IF NOT EXISTS "minerType" TEXT NOT NULL DEFAULT 'standard';

-- Sync miningPower = basePower for existing rows
UPDATE "miners" SET "miningPower" = "basePower" WHERE "miningPower" = 0;

-- ─────────────────────────────────────────
-- STEP 2: Extend mining_rooms table
-- Drop old unique constraint on userId (1 room per user),
-- add multi-room columns, add new composite unique.
-- ─────────────────────────────────────────

-- Add new columns (nullable/default first to avoid lock issues)
ALTER TABLE "mining_rooms" ADD COLUMN IF NOT EXISTS "roomNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "mining_rooms" ADD COLUMN IF NOT EXISTS "isUnlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mining_rooms" ADD COLUMN IF NOT EXISTS "unlockCost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "mining_rooms" ADD COLUMN IF NOT EXISTS "gridCols" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "mining_rooms" ADD COLUMN IF NOT EXISTS "gridRows" INTEGER NOT NULL DEFAULT 3;

-- Mark all existing rooms as Room 01 and unlocked
UPDATE "mining_rooms" SET "roomNumber" = 1, "isUnlocked" = true WHERE "roomNumber" = 1;

-- Drop old single-user unique constraint
DROP INDEX IF EXISTS "mining_rooms_userId_key";

-- Add new composite unique: one room per number per user
CREATE UNIQUE INDEX IF NOT EXISTS "mining_rooms_userId_roomNumber_key"
    ON "mining_rooms"("userId", "roomNumber");

-- ─────────────────────────────────────────
-- STEP 3: Remove slotPosition from user_miners if it exists
-- (safe — only drops if column exists)
-- ─────────────────────────────────────────
ALTER TABLE "user_miners" DROP COLUMN IF EXISTS "slotPosition";

-- ─────────────────────────────────────────
-- STEP 4: Create rack_products table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rack_products" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "imageUrl"      TEXT NOT NULL DEFAULT '/assets/racks/rack-basic.svg',
    "price"         INTEGER NOT NULL,
    "minerCapacity" INTEGER NOT NULL DEFAULT 4,
    "rackType"      TEXT NOT NULL DEFAULT 'basic',
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rack_products_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
-- STEP 5: Create user_rack_inventory table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_rack_inventory" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "rackProductId" TEXT NOT NULL,
    "acquiredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_rack_inventory_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
-- STEP 6: Create user_rack_placements table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_rack_placements" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "roomId"          TEXT NOT NULL,
    "rackInventoryId" TEXT NOT NULL,
    "rackProductId"   TEXT NOT NULL,
    "slotIndex"       INTEGER NOT NULL,
    "placedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_rack_placements_pkey" PRIMARY KEY ("id")
);

-- One rack inventory item can only be placed once
CREATE UNIQUE INDEX IF NOT EXISTS "user_rack_placements_rackInventoryId_key"
    ON "user_rack_placements"("rackInventoryId");

-- One slot per room can only hold one rack
CREATE UNIQUE INDEX IF NOT EXISTS "user_rack_placements_roomId_slotIndex_key"
    ON "user_rack_placements"("roomId", "slotIndex");

-- ─────────────────────────────────────────
-- STEP 7: Create user_miner_placements table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_miner_placements" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "rackPlacementId" TEXT NOT NULL,
    "userMinerId"     TEXT NOT NULL,
    "slotIndex"       INTEGER NOT NULL,
    "placedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_miner_placements_pkey" PRIMARY KEY ("id")
);

-- One miner can only be placed in one rack slot at a time
CREATE UNIQUE INDEX IF NOT EXISTS "user_miner_placements_userMinerId_key"
    ON "user_miner_placements"("userMinerId");

-- One slot per rack placement can only hold one miner
CREATE UNIQUE INDEX IF NOT EXISTS "user_miner_placements_rackPlacementId_slotIndex_key"
    ON "user_miner_placements"("rackPlacementId", "slotIndex");

-- ─────────────────────────────────────────
-- STEP 8: Create room_config table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "room_config" (
    "id"         TEXT NOT NULL,
    "roomNumber" INTEGER NOT NULL,
    "unlockCost" INTEGER NOT NULL DEFAULT 0,
    "name"       TEXT NOT NULL DEFAULT '',
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_config_roomNumber_key"
    ON "room_config"("roomNumber");

-- Seed default room configs
INSERT INTO "room_config" ("id", "roomNumber", "unlockCost", "name", "isActive", "updatedAt")
VALUES
    (gen_random_uuid()::text, 1, 0,     'Room 01', true, NOW()),
    (gen_random_uuid()::text, 2, 5000,  'Room 02', true, NOW()),
    (gen_random_uuid()::text, 3, 15000, 'Room 03', true, NOW()),
    (gen_random_uuid()::text, 4, 30000, 'Room 04', true, NOW())
ON CONFLICT ("roomNumber") DO NOTHING;

-- ─────────────────────────────────────────
-- STEP 9: Add Foreign Keys
-- ─────────────────────────────────────────

-- user_rack_inventory → users
ALTER TABLE "user_rack_inventory"
    ADD CONSTRAINT "user_rack_inventory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_rack_inventory → rack_products
ALTER TABLE "user_rack_inventory"
    ADD CONSTRAINT "user_rack_inventory_rackProductId_fkey"
    FOREIGN KEY ("rackProductId") REFERENCES "rack_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- user_rack_placements → users
ALTER TABLE "user_rack_placements"
    ADD CONSTRAINT "user_rack_placements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_rack_placements → mining_rooms
ALTER TABLE "user_rack_placements"
    ADD CONSTRAINT "user_rack_placements_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "mining_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_rack_placements → user_rack_inventory
ALTER TABLE "user_rack_placements"
    ADD CONSTRAINT "user_rack_placements_rackInventoryId_fkey"
    FOREIGN KEY ("rackInventoryId") REFERENCES "user_rack_inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_rack_placements → rack_products
ALTER TABLE "user_rack_placements"
    ADD CONSTRAINT "user_rack_placements_rackProductId_fkey"
    FOREIGN KEY ("rackProductId") REFERENCES "rack_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- user_miner_placements → users
ALTER TABLE "user_miner_placements"
    ADD CONSTRAINT "user_miner_placements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_miner_placements → user_rack_placements
ALTER TABLE "user_miner_placements"
    ADD CONSTRAINT "user_miner_placements_rackPlacementId_fkey"
    FOREIGN KEY ("rackPlacementId") REFERENCES "user_rack_placements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_miner_placements → user_miners
ALTER TABLE "user_miner_placements"
    ADD CONSTRAINT "user_miner_placements_userMinerId_fkey"
    FOREIGN KEY ("userMinerId") REFERENCES "user_miners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
