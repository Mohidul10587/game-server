import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { RewardWorker, REWARD_QUEUE, DISTRIBUTE_JOB } from './reward.worker.js';

const CYCLE_MINUTES = 10;

@Module({
  imports: [
    BullModule.registerQueue({
      name: REWARD_QUEUE,
    }),
  ],
  providers: [RewardWorker],
  exports: [BullModule],
})
export class RewardModule implements OnModuleInit {
  private readonly logger = new Logger(RewardModule.name);

  constructor(
    @InjectQueue(REWARD_QUEUE) private rewardQueue: Queue,
  ) {}

  /**
   * Wait for the Bull queue's Redis connection to be ready before
   * issuing any commands. With `enableOfflineQueue: false`, commands
   * issued before the connection is established are rejected with
   * "Stream isn't writeable". This guard prevents that error.
   *
   * Times out after 15s (slightly above connectTimeout of 10s) so the
   * app doesn't hang indefinitely on startup if Redis is unreachable.
   */
  private async waitForQueueReady(): Promise<void> {
    const READY_TIMEOUT_MS = 15_000;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `[RewardModule] Redis connection not ready after ${READY_TIMEOUT_MS}ms — ` +
              `check UPSTASH_REDIS_HOST/PORT/PASSWORD env vars`,
          ),
        );
      }, READY_TIMEOUT_MS);

      // Bull's isReady() resolves when the client connection is ready.
      // It returns a promise that resolves on the 'ready' event.
      this.rewardQueue
        .isReady()
        .then(() => {
          clearTimeout(timeout);
          this.logger.log('Bull reward queue Redis connection is ready');
          resolve();
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `[RewardModule] Redis connection failed: ${err?.message ?? err}`,
            ),
          );
        });
    });
  }

  async onModuleInit() {
    // Wait for Redis connection before issuing any queue commands.
    // With enableOfflineQueue: false, this is mandatory — without it,
    // getRepeatableJobs() throws "Stream isn't writeable".
    await this.waitForQueueReady();

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await this.rewardQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.rewardQueue.removeRepeatableByKey(job.key);
    }

    // Schedule the reward distribution every 10 minutes.
    // attempts: 3 with exponential backoff (5s, 10s, 20s) ensures
    // transient DB/Redis failures get retried. On retry, Bull reuses
    // the same job instance → same prevMillis → same cycleId →
    // already-rewarded users skipped via P2002.
    await this.rewardQueue.add(
      DISTRIBUTE_JOB,
      {},
      {
        repeat: { every: CYCLE_MINUTES * 60 * 1000 },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    this.logger.log(
      `Reward worker scheduled every ${CYCLE_MINUTES} minutes`,
    );
  }
}
