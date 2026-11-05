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

  async onModuleInit() {
    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await this.rewardQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.rewardQueue.removeRepeatableByKey(job.key);
    }

    // Schedule the reward distribution every 10 minutes
    await this.rewardQueue.add(
      DISTRIBUTE_JOB,
      {},
      {
        repeat: { every: CYCLE_MINUTES * 60 * 1000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    this.logger.log(
      `Reward worker scheduled every ${CYCLE_MINUTES} minutes`,
    );
  }
}
