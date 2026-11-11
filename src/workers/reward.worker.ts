import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export const REWARD_QUEUE = 'reward';
export const DISTRIBUTE_JOB = 'distribute';

@Injectable()
@Processor(REWARD_QUEUE)
export class RewardWorker {
  private readonly logger = new Logger(RewardWorker.name);
  private readonly POWER_KEY = 'mining:powers';

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Process(DISTRIBUTE_JOB)
  async handleDistribute(job: Job) {
    // ── Stable Cycle ID from Bull's scheduled timestamp ───────────────────
    const prevMillis = (job.opts as any)?.prevMillis as number | undefined;

    let cycleId: string;
    if (prevMillis && typeof prevMillis === 'number') {
      cycleId = new Date(prevMillis).toISOString();
    } else {
      const now = new Date();
      const cycleMs = 10 * 60 * 1000;
      const cycleStart = new Date(Math.floor(now.getTime() / cycleMs) * cycleMs);
      cycleId = cycleStart.toISOString();
      this.logger.warn(
        `job.opts.prevMillis not available, using fallback cycleId: ${cycleId}`,
      );
    }

    this.logger.log(`Starting reward distribution cycle: ${cycleId}`);

    try {
      // 1. Clean expired temporary powers first
      await this.cleanExpiredPowers();

      // 2. Read all powers from Redis
      const powersMap = await this.redis.hgetall(this.POWER_KEY);

      if (!powersMap || Object.keys(powersMap).length === 0) {
        this.logger.log('No miners active, skipping distribution');
        return;
      }

      // 3. Load all active pools
      const pools = await this.prisma.pool.findMany({
        where: { isActive: true },
      });

      if (pools.length === 0) {
        this.logger.warn('No active pools found, skipping distribution');
        return;
      }

      // 4. Build power entries
      const entries = Object.entries(powersMap)
        .map(([userId, powerStr]) => ({
          userId,
          power: parseInt(powerStr, 10),
        }))
        .filter((e) => e.power > 0);

      if (entries.length === 0) {
        this.logger.log('Total power is 0, skipping distribution');
        return;
      }

      // 5. Load all user pool allocations (for active users)
      const userIds = entries.map((e) => e.userId);
      const allocations = await this.prisma.userPoolAllocation.findMany({
        where: { userId: { in: userIds } },
      });

      // Build map: userId → { poolId → percent (0–100) }
      const userAllocMap = new Map<string, Map<string, number>>();
      for (const alloc of allocations) {
        if (!userAllocMap.has(alloc.userId)) {
          userAllocMap.set(alloc.userId, new Map());
        }
        userAllocMap.get(alloc.userId)!.set(alloc.poolId, Number(alloc.powerPercent));
      }

      // 6. Per-pool distribution
      let totalDistributed = 0;
      let totalSkipped = 0;
      const allErrors: Error[] = [];

      for (const pool of pools) {
        const poolAmount = Number(pool.poolAmountPerCycle);
        if (poolAmount <= 0) continue;

        // Calculate effective power for this pool per user
        // If user has no allocation → 0 power in this pool
        // If user has allocations → allocate proportional power
        const poolEntries = entries
          .map((e) => {
            const userAllocs = userAllocMap.get(e.userId);
            const poolPercent = userAllocs?.get(pool.id) ?? 0;
            return {
              userId: e.userId,
              poolPower: Math.floor((e.power * poolPercent) / 100),
            };
          })
          .filter((e) => e.poolPower > 0);

        if (poolEntries.length === 0) {
          this.logger.log(`Pool ${pool.currency}: no power allocated, skipping`);
          continue;
        }

        const totalPoolPower = poolEntries.reduce((sum, e) => sum + e.poolPower, 0);

        this.logger.log(
          `Pool ${pool.currency}: distributing ${poolAmount} ${pool.currency} among ${poolEntries.length} miners (total pool power: ${totalPoolPower} Gh/s)`,
        );

        await Promise.all(
          poolEntries.map(async ({ userId, poolPower }) => {
            const sharePercent = poolPower / totalPoolPower;
            const reward = sharePercent * poolAmount;
            if (reward <= 0) return;

            const cyclePoolId = `${cycleId}:${pool.id}`;

            try {
              await this.prisma.$transaction(async (tx) => {
                // Idempotent: (userId, cycleId+poolId, currency) unique
                await tx.rewardHistory.create({
                  data: {
                    userId,
                    cycleId: cyclePoolId,
                    currency: pool.currency,
                    amount: reward,
                    poolSharePercent: sharePercent * 100,
                  },
                });

                await tx.cryptoBalance.upsert({
                  where: { userId_currency: { userId, currency: pool.currency } },
                  update: { amount: { increment: reward } },
                  create: { userId, currency: pool.currency, amount: reward },
                });
              });
              totalDistributed++;
            } catch (err: any) {
              if (err?.code === 'P2002') {
                totalSkipped++;
                this.logger.debug(
                  `Cycle ${cyclePoolId}: user ${userId} already rewarded in pool ${pool.currency}, skipping`,
                );
              } else {
                this.logger.error(
                  `Failed to distribute ${pool.currency} reward to ${userId}:`,
                  err,
                );
                allErrors.push(err);
              }
            }
          }),
        );
      }

      this.logger.log(
        `Cycle ${cycleId} complete — distributed: ${totalDistributed}, skipped: ${totalSkipped}, errors: ${allErrors.length}`,
      );

      if (allErrors.length > 0) {
        throw new Error(
          `Cycle ${cycleId} failed for ${allErrors.length} distribution(s): ${allErrors[0].message}`,
        );
      }

      // 7. Re-sync Redis from DB
      await this.syncRedisFromDb();
    } catch (err) {
      this.logger.error('Reward distribution failed:', err);
      throw err;
    }
  }

  private async cleanExpiredPowers() {
    const now = new Date();

    const expired = await this.prisma.miningPower.findMany({
      where: {
        tempExpiresAt: { lt: now },
        temporaryPower: { gt: 0 },
      },
      select: { userId: true },
    });

    if (expired.length === 0) return;

    await this.prisma.miningPower.updateMany({
      where: {
        userId: { in: expired.map((e) => e.userId) },
      },
      data: {
        temporaryPower: 0,
        tempExpiresAt: null,
      },
    });

    this.logger.log(`Cleaned ${expired.length} expired temporary powers`);
  }

  private async syncRedisFromDb() {
    const powers = await this.prisma.miningPower.findMany({
      select: { userId: true, temporaryPower: true, permanentPower: true },
    });

    for (const mp of powers) {
      const totalPower = mp.temporaryPower + mp.permanentPower;
      if (totalPower > 0) {
        await this.redis.hset(this.POWER_KEY, mp.userId, String(totalPower));
      }
    }

    this.logger.log(`Synced ${powers.length} power entries to Redis`);
  }
}
