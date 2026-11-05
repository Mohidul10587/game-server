import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { Redis as IORedis } from 'ioredis';
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
   * Wait for the Bull queue's Redis **client** (the one used by
   * getRepeatableJobs, add, etc.) to be fully connected and ready for
   * commands.
   *
   * Bull's `isReady()` only awaits `_initializing`, which is the
   * synchronous `loadCommands()` / `defineCommand()` step — it does
   * NOT wait for the ioredis TCP `ready` event.  With
   * `enableOfflineQueue: false`, any command sent before ioredis
   * reaches `status === 'ready'` is rejected with
   * "Stream isn't writeable and enableOfflineQueue options is false".
   *
   * Fix: after `isReady()` (which also triggers lazy client creation),
   * explicitly wait for the underlying ioredis client's `ready` event.
   *
   * Times out after 15s (slightly above connectTimeout of 10s) so the
   * app doesn't hang indefinitely on startup if Redis is unreachable.
   */
  private async waitForQueueReady(): Promise<void> {
    const READY_TIMEOUT_MS = 15_000;

    // Step 1: Bull's isReady() — triggers lazy client creation and
    // resolves once defineCommand() calls finish (synchronous).
    await this.rewardQueue.isReady();

    // Step 2: Wait for the ioredis client's TCP 'ready' event.
    // This is the event that actually means "stream is writeable".
    const client = (this.rewardQueue as any).client as IORedis;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `[RewardModule] Redis client not ready after ${READY_TIMEOUT_MS}ms — ` +
              `check UPSTASH_REDIS_HOST/PORT/PASSWORD env vars`,
          ),
        );
      }, READY_TIMEOUT_MS);

      if (client.status === 'ready') {
        clearTimeout(timeout);
        resolve();
        return;
      }

      const onReady = () => {
        clearTimeout(timeout);
        client.removeListener('error', onError);
        client.removeListener('end', onEnd);
        resolve();
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        client.removeListener('ready', onReady);
        client.removeListener('end', onEnd);
        reject(
          new Error(
            `[RewardModule] Redis connection failed: ${err?.message ?? err}`,
          ),
        );
      };

      const onEnd = () => {
        clearTimeout(timeout);
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        reject(
          new Error(`[RewardModule] Redis connection ended before ready`),
        );
      };

      client.once('ready', onReady);
      client.once('error', onError);
      client.once('end', onEnd);
    });

    // ── Diagnostic: log all three Bull Redis clients' state ──────────
    this.logClientDiagnostics();

    this.logger.log('Bull reward queue Redis connection is ready');
  }

  /**
   * Log the connection state of all three Bull Redis clients:
   * client (commands), eclient (subscriber), bclient (blocking).
   *
   * Bull lazily creates each client — accessing the getter triggers
   * creation.  We check the `*Initialized` flags first to see which
   * have been created, then log status/isOpen for each.
   */
  private logClientDiagnostics(): void {
    const q = this.rewardQueue as any;

    const types: Array<'client' | 'eclient' | 'bclient'> = [
      'client',
      'eclient',
      'bclient',
    ];

    for (const type of types) {
      const initialized = q[`${type}Initialized`] === true;
      if (!initialized) {
        this.logger.log(`[${type}] not yet initialized (lazy)`);
        continue;
      }

      const c = q[type] as IORedis | undefined;
      if (!c) {
        this.logger.log(`[${type}] initialized but client is undefined`);
        continue;
      }

      this.logger.log(
        `[${type}] status=${c.status} isOpen=${c.status !== 'end' && c.status !== 'close'} ` +
          `stream=${c.stream ? 'exists' : 'null'} ` +
          `streamWritable=${c.stream ? c.stream.writable : 'n/a'}`,
      );
    }
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
