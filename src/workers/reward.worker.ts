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
  async handleDistribute(_job: Job) {
    this.logger.log('Starting reward distribution cycle...');

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

      // 5. Distribute rewards in parallel (batched)
      await Promise.all(
        entries.map(async ({ userId, power }) => {
          const sharePercent = power / totalPower;
          const satoshiReward = Math.floor(sharePercent * poolAmount);
          if (satoshiReward === 0) return;

          // Convert satoshi to BTC (1 BTC = 100,000,000 satoshi)
          const btcReward = satoshiReward / 100_000_000;

          try {
            await this.prisma.$transaction(async (tx) => {
              // Upsert BTC crypto balance
              await tx.cryptoBalance.upsert({
                where: { userId_currency: { userId, currency: 'BTC' } },
                update: { amount: { increment: btcReward } },
                create: { userId, currency: 'BTC', amount: btcReward },
              });

              // Create reward history
              await tx.rewardHistory.create({
                data: {
                  userId,
                  currency: 'BTC',
                  amount: btcReward,
                  poolSharePercent: sharePercent * 100,
                },
              });
            });
          } catch (err) {
            this.logger.error(`Failed to distribute reward to ${userId}:`, err);
          }
        }),
      );

      this.logger.log('Reward distribution cycle complete');

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
