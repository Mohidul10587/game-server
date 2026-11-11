import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MailerService } from '../mailer/mailer.service.js';

const MIN_WITHDRAWAL: Record<string, number> = {
  BTC: 0.00085,
  ETH: 0.01,
  SOL: 0.1,
};

@Injectable()
export class MiningService {
  private readonly logger = new Logger(MiningService.name);
  private readonly POWER_KEY = 'mining:powers';

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private mailer: MailerService,
  ) {}

  async getPower(userId: string) {
    const mp = await this.prisma.miningPower.findUnique({
      where: { userId },
    });

    if (!mp) {
      return {
        temporaryPower: 0,
        permanentPower: 0,
        totalPower: 0,
        tempExpiresAt: null,
      };
    }

    const now = new Date();
    const tempExpired = mp.tempExpiresAt && mp.tempExpiresAt < now;
    const temporaryPower = tempExpired ? 0 : mp.temporaryPower;
    const totalPower = temporaryPower + mp.permanentPower;

    return {
      temporaryPower,
      permanentPower: mp.permanentPower,
      totalPower,
      tempExpiresAt: mp.tempExpiresAt,
    };
  }

  async getBalance(userId: string) {
    const [coinBalance, cryptoBalances] = await Promise.all([
      this.prisma.coinBalance.findUnique({ where: { userId } }),
      this.prisma.cryptoBalance.findMany({ where: { userId } }),
    ]);

    // Build a map of all crypto balances
    const cryptoMap: Record<string, number> = {};
    for (const cb of cryptoBalances) {
      cryptoMap[cb.currency] = Number(cb.amount);
    }

    return {
      coins: coinBalance?.amount ?? 0,
      BTC: cryptoMap['BTC'] ?? 0,
      ETH: cryptoMap['ETH'] ?? 0,
      SOL: cryptoMap['SOL'] ?? 0,
      // Also return all as array for flexibility
      crypto: cryptoBalances.map((cb) => ({
        currency: cb.currency,
        amount: Number(cb.amount),
      })),
    };
  }

  async getHistory(userId: string) {
    return this.prisma.rewardHistory.findMany({
      where: { userId },
      orderBy: { distributedAt: 'desc' },
      take: 50,
    });
  }

  async requestWithdrawal(
    userId: string,
    currency: string,
    amount: number,
    walletAddress: string,
  ) {
    const currencyUpper = currency.toUpperCase();
    const minimum = MIN_WITHDRAWAL[currencyUpper];

    if (!minimum) {
      throw new BadRequestException(`Unsupported currency: ${currencyUpper}`);
    }

    if (amount < minimum) {
      throw new BadRequestException(
        `Minimum withdrawal for ${currencyUpper} is ${minimum}`,
      );
    }

    // Check for existing pending withdrawal
    const pending = await this.prisma.withdrawal.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) {
      throw new BadRequestException(
        'You already have a pending withdrawal. Wait for it to be processed.',
      );
    }

    // Check balance
    const balance = await this.prisma.cryptoBalance.findUnique({
      where: { userId_currency: { userId, currency: currencyUpper } },
    });

    if (!balance || Number(balance.amount) < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Fetch user info for email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    // Deduct balance and create withdrawal in transaction
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      await tx.cryptoBalance.update({
        where: { userId_currency: { userId, currency: currencyUpper } },
        data: { amount: { decrement: amount } },
      });

      return tx.withdrawal.create({
        data: {
          userId,
          currency: currencyUpper,
          amount,
          walletAddress,
          status: 'PENDING',
        },
      });
    });

    this.logger.log(
      `Withdrawal requested by ${userId}: ${amount} ${currencyUpper}`,
    );

    // Send confirmation email (non-blocking — don't fail the request if email fails)
    if (user) {
      this.mailer
        .sendWithdrawalConfirmation(
          user.email,
          user.username,
          amount,
          currencyUpper,
          walletAddress,
        )
        .catch((err) => {
          this.logger.warn(`Failed to send withdrawal email: ${err.message}`);
        });
    }

    return {
      ...withdrawal,
      message: 'Withdrawal request submitted. Check your email for confirmation.',
    };
  }

  async syncPowerToRedis(userId: string) {
    const power = await this.getPower(userId);
    await this.redis.hset(
      this.POWER_KEY,
      userId,
      String(power.totalPower),
    );
    return power;
  }
}
