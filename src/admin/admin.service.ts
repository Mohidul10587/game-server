import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  async getPendingWithdrawals() {
    return this.prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: { id: true, username: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveWithdrawal(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') {
      throw new BadRequestException(
        `Withdrawal is already ${withdrawal.status}`,
      );
    }

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'APPROVED',
        processedAt: new Date(),
      },
    });

    this.logger.log(`Withdrawal ${withdrawalId} approved`);
    return updated;
  }

  async rejectWithdrawal(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') {
      throw new BadRequestException(
        `Withdrawal is already ${withdrawal.status}`,
      );
    }

    // Refund the balance
    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', processedAt: new Date() },
      });

      await tx.cryptoBalance.upsert({
        where: {
          userId_currency: {
            userId: withdrawal.userId,
            currency: withdrawal.currency,
          },
        },
        update: { amount: { increment: withdrawal.amount } },
        create: {
          userId: withdrawal.userId,
          currency: withdrawal.currency,
          amount: withdrawal.amount,
        },
      });
    });

    this.logger.log(`Withdrawal ${withdrawalId} rejected and refunded`);
    return { success: true };
  }

  async getRewardConfig() {
    const config = await this.prisma.rewardConfig.findFirst();
    if (!config) {
      // Return defaults if none exists yet
      return {
        id: null,
        poolAmountPerCycle: 50000,
        cycleMinutes: 10,
        updatedAt: new Date(),
      };
    }
    return config;
  }

  async updateRewardConfig(
    poolAmountPerCycle?: number,
    cycleMinutes?: number,
  ) {
    if (poolAmountPerCycle !== undefined && poolAmountPerCycle <= 0) {
      throw new BadRequestException('Pool amount must be positive');
    }
    if (cycleMinutes !== undefined && cycleMinutes < 1) {
      throw new BadRequestException('Cycle minutes must be at least 1');
    }

    const existing = await this.prisma.rewardConfig.findFirst();

    if (!existing) {
      return this.prisma.rewardConfig.create({
        data: {
          poolAmountPerCycle: poolAmountPerCycle ?? 50000,
          cycleMinutes: cycleMinutes ?? 10,
        },
      });
    }

    return this.prisma.rewardConfig.update({
      where: { id: existing.id },
      data: {
        ...(poolAmountPerCycle !== undefined && { poolAmountPerCycle }),
        ...(cycleMinutes !== undefined && { cycleMinutes }),
      },
    });
  }

  async banUser(userId: string, ban: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'ADMIN') {
      throw new BadRequestException('Cannot ban an admin user');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: ban },
      select: { id: true, username: true, isBanned: true },
    });

    this.logger.log(
      `User ${userId} ${ban ? 'banned' : 'unbanned'} by admin`,
    );

    return updated;
  }

  async getUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isBanned: true,
        createdAt: true,
        miningPower: {
          select: { permanentPower: true, temporaryPower: true },
        },
        cryptoBalances: {
          select: { currency: true, amount: true },
        },
        _count: {
          select: { gameSessionss: true, withdrawals: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDashboardStats() {
    const [users, activePowers, pendingWithdrawals] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.miningPower.aggregate({
        _sum: { permanentPower: true, temporaryPower: true },
      }),
      this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      totalUsers: users,
      totalPermanentPower: activePowers._sum.permanentPower ?? 0,
      totalTemporaryPower: activePowers._sum.temporaryPower ?? 0,
      pendingWithdrawals,
    };
  }
}
