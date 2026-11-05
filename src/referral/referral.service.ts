import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async getReferralStats(userId: string) {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referrer: { select: { id: true } },
      },
    });

    // Each referral earns the referrer 500 coins
    const totalEarnings = referrals.length * 500;

    return {
      referralCount: referrals.length,
      totalEarnings,
    };
  }

  async getReferralLink(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      return { referralCode: null, referralLink: null };
    }

    const clientUrl = this.config.get<string>('CLIENT_URL', 'http://localhost:3000');
    const referralLink = `${clientUrl}/register?ref=${user.referralCode}`;

    return {
      referralCode: user.referralCode,
      referralLink,
    };
  }

  async getReferralList(userId: string) {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return referrals;
  }
}
