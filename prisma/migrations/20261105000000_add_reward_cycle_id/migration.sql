-- ─────────────────────────────────────────────────────────────────────
-- Migration: Add reward cycle ID for idempotent distribution
-- Strategy: Additive — no existing data is deleted or modified
-- Steps:
--   1. Add nullable "cycleId" column
--   2. Backfill existing records with unique legacy- prefix
--   3. Set column to NOT NULL
--   4. Add unique constraint on (userId, cycleId, currency)
-- ─────────────────────────────────────────────────────────────────────

-- Step 1: Add nullable column (safe for existing rows — defaults to NULL)
ALTER TABLE "reward_history" ADD COLUMN "cycleId" TEXT;

-- Step 2: Backfill existing rows with unique legacy- prefix
--         Each row gets "legacy-<id>" which is unique per record
UPDATE "reward_history"
SET "cycleId" = CONCAT('legacy-', "id")
WHERE "cycleId" IS NULL;

-- Step 3: Make column NOT NULL (safe — all rows now have a value)
ALTER TABLE "reward_history" ALTER COLUMN "cycleId" SET NOT NULL;

-- Step 4: Add unique constraint to prevent duplicate rewards per cycle per user
CREATE UNIQUE INDEX "reward_history_userId_cycleId_currency_key"
  ON "reward_history" ("userId", "cycleId", "currency");
