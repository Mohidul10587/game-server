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
    // Bull v4 repeatable jobs store `prevMillis` in job.opts — this is the
    // scheduled execution time (nextMillis) assigned by the repeatable
    // scheduler. It is serialized to Redis via toJSON and restored via
    // fromJSON, so it survives stalled recovery, retries, and restarts.
    // Using this instead of new Date() guarantees that the same logical
    // job always produces the same cycleId.
    const prevMillis = (job.opts as any)?.prevMillis as number | undefined;

    let cycleId: string;
    if (prevMillis && typeof prevMillis === 'number') {
      // Use the Bull-scheduled timestamp directly — deterministic per cycle
      cycleId = new Date(prevMillis).toISOString();
    } else {
      // Fallback: floor current time to 10-min window (for manual/non-repeat jobs)
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

      // 3. Get reward config
      const config = await this.prisma.rewardConfig.findFirst();
      if (!config) {
        this.logger.warn('No reward config found, skipping distribution');
        return;
      }

      const poolAmount = config.poolAmountPerCycle; // in satoshi

      // 4. Calculate total power
      const entries = Object.entries(powersMap)
        .map(([userId, powerStr]) => ({
          userId,
          power: parseInt(powerStr, 10),
        }))
        .filter((e) => e.power > 0);

      const totalPower = entries.reduce((sum, e) => sum + e.power, 0);
      if (totalPower === 0) {
        this.logger.log('Total power is 0, skipping distribution');
        return;
      }

      this.logger.log(
        `Distributing ${poolAmount} satoshi among ${entries.length} miners (total power: ${totalPower} Gh/s)`,
      );

      // 5. Distribute rewards in parallel — idempotent via cycleId unique constraint
      let distributed = 0;
      let skipped = 0;
      const errors: Error[] = [];

      await Promise.all(
        entries.map(async ({ userId, power }) => {
          const sharePercent = power / totalPower;
          const satoshiReward = Math.floor(sharePercent * poolAmount);
          if (satoshiReward === 0) return;

          const btcReward = satoshiReward / 100_000_000;

          try {
            await this.prisma.$transaction(async (tx) => {
              // Attempt to create reward history with cycleId.
              // If this (userId, cycleId, currency) already exists, Prisma throws P2002.
              // We catch it below to skip gracefully.
              await tx.rewardHistory.create({
                data: {
                  userId,
                  cycleId,
                  currency: 'BTC',
                  amount: btcReward,
                  poolSharePercent: sharePercent * 100,
                },
              });

              // Only update balance if history insert succeeded
              await tx.cryptoBalance.upsert({
                where: { userId_currency: { userId, currency: 'BTC' } },
                update: { amount: { increment: btcReward } },
                create: { userId, currency: 'BTC', amount: btcReward },
              });
            });
            distributed++;
          } catch (err: any) {
            // P2002 = unique constraint violation → this cycle already rewarded this user
            if (err?.code === 'P2002') {
              skipped++;
              this.logger.debug(
                `Cycle ${cycleId}: user ${userId} already rewarded, skipping`,
              );
            } else {
              // Non-P2002 error — collect for propagation after all users processed
              this.logger.error(
                `Failed to distribute reward to ${userId}:`,
                err,
              );
              errors.push(err);
            }
          }
        }),
      );

      this.logger.log(
        `Cycle ${cycleId} complete — distributed: ${distributed}, skipped (already done): ${skipped}, errors: ${errors.length}`,
      );

      // If any non-P2002 errors occurred, throw to mark the job as failed.
      // Bull will retry with the same job (same prevMillis → same cycleId),
      // and already-rewarded users will be skipped via P2002 on retry.
      if (errors.length > 0) {
        throw new Error(
          `Cycle ${cycleId} failed for ${errors.length} user(s): ${errors[0].message}`,
        );
      }

      // 6. Re-sync Redis from DB
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
