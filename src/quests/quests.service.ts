import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class QuestsService {
  private readonly logger = new Logger(QuestsService.name);

  constructor(private prisma: PrismaService) {}

  async getActiveQuests(userId: string) {
    // Get all active quests
    const quests = await this.prisma.quest.findMany({
      where: { isActive: true },
      orderBy: { type: 'asc' },
    });

    if (quests.length === 0) return [];

    // Get user's progress for each quest
    const questIds = quests.map((q) => q.id);
    const userQuests = await this.prisma.userQuest.findMany({
      where: { userId, questId: { in: questIds } },
    });

    const progressMap = new Map(userQuests.map((uq) => [uq.questId, uq]));

    return quests.map((quest) => {
      const progress = progressMap.get(quest.id);
      return {
        ...quest,
        progress: progress?.progress ?? 0,
        isCompleted: progress?.isCompleted ?? false,
        isClaimed: progress?.isClaimed ?? false,
        completedAt: progress?.completedAt ?? null,
      };
    });
  }

  async updateQuestProgress(userId: string, action: string) {
    // Find quests matching this action that are still active
    const quests = await this.prisma.quest.findMany({
      where: {
        isActive: true,
        requiredAction: action,
      },
    });

    if (quests.length === 0) return;

    for (const quest of quests) {
      const userQuest = await this.prisma.userQuest.upsert({
        where: { userId_questId: { userId, questId: quest.id } },
        update: {},
        create: {
          userId,
          questId: quest.id,
          progress: 0,
        },
      });

      // Skip already completed quests
      if (userQuest.isCompleted) continue;

      const newProgress = userQuest.progress + 1;
      const isCompleted = newProgress >= quest.targetValue;

      await this.prisma.userQuest.update({
        where: { userId_questId: { userId, questId: quest.id } },
        data: {
          progress: newProgress,
          isCompleted,
          completedAt: isCompleted ? new Date() : undefined,
        },
      });

      if (isCompleted) {
        this.logger.log(`User ${userId} completed quest: ${quest.title}`);
      }
    }
  }

  async claimReward(userId: string, questId: string) {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    const userQuest = await this.prisma.userQuest.findUnique({
      where: { userId_questId: { userId, questId } },
    });

    if (!userQuest) {
      throw new BadRequestException('Quest not started');
    }
    if (!userQuest.isCompleted) {
      throw new BadRequestException('Quest not completed yet');
    }
    if (userQuest.isClaimed) {
      throw new BadRequestException('Reward already claimed');
    }

    await this.prisma.$transaction(async (tx) => {
      // Mark as claimed
      await tx.userQuest.update({
        where: { userId_questId: { userId, questId } },
        data: { isClaimed: true },
      });

      // Give reward based on type
      if (quest.rewardType === 'COIN') {
        await tx.coinBalance.upsert({
          where: { userId },
          update: { amount: { increment: quest.rewardAmount } },
          create: { userId, amount: quest.rewardAmount },
        });
      }
      // CRYPTO and MINER rewards can be extended later
    });

    this.logger.log(
      `User ${userId} claimed reward for quest ${quest.title}: ${quest.rewardAmount} ${quest.rewardType}`,
    );

    return {
      questId,
      rewardType: quest.rewardType,
      rewardAmount: quest.rewardAmount,
    };
  }
}
