import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private prisma: PrismaService) {}

  async getTop100() {
    const powers = await this.prisma.miningPower.findMany({
      orderBy: [{ permanentPower: 'desc' }, { temporaryPower: 'desc' }],
      take: 100,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return powers.map((mp, index) => ({
      rank: index + 1,
      userId: mp.userId,
      username: mp.user.username,
      avatarUrl: mp.user.avatarUrl,
      permanentPower: mp.permanentPower,
      temporaryPower: mp.temporaryPower,
      totalPower: mp.permanentPower + mp.temporaryPower,
    }));
  }

  async getMyRank(userId: string) {
    // Get my total power
    const myPower = await this.prisma.miningPower.findUnique({
      where: { userId },
    });

    if (!myPower) {
      return { rank: null, totalPower: 0 };
    }

    const myTotal = myPower.permanentPower + myPower.temporaryPower;

    // Count users with strictly higher total power
    const higher = await this.prisma.miningPower.count({
      where: {
        OR: [
          { permanentPower: { gt: myPower.permanentPower } },
          {
            permanentPower: myPower.permanentPower,
            temporaryPower: { gt: myPower.temporaryPower },
          },
        ],
      },
    });

    return {
      rank: higher + 1,
      totalPower: myTotal,
      permanentPower: myPower.permanentPower,
      temporaryPower: myPower.temporaryPower,
    };
  }
}
