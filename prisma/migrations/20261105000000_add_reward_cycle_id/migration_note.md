# Migration: add_reward_cycle_id

## Purpose
Add `cycleId` column to `reward_history` table for cycle-based idempotent reward distribution.

## Strategy
Additive migration — no existing data is deleted, modified, or reset.

### Steps:
1. **Add nullable column** — `ALTER TABLE ... ADD COLUMN "cycleId" TEXT`
2. **Backfill existing rows** — `UPDATE ... SET "cycleId" = CONCAT('legacy-', "id")` — gives each existing record a unique placeholder
3. **Set NOT NULL** — `ALTER TABLE ... ALTER COLUMN "cycleId" SET NOT NULL`
4. **Add unique constraint** — `CREATE UNIQUE INDEX ... ON ("userId", "cycleId", "currency")`

## Production Deployment
```bash
# Review the migration SQL first
cat prisma/migrations/20261105000000_add_reward_cycle_id/migration.sql

# Apply in production (non-interactive)
npx prisma migrate deploy
```

## Rollback (if needed)
```sql
DROP INDEX IF EXISTS "reward_history_userId_cycleId_currency_key";
ALTER TABLE "reward_history" ALTER COLUMN "cycleId" DROP NOT NULL;
ALTER TABLE "reward_history" DROP COLUMN "cycleId";
```
