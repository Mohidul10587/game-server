import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const MARKETPLACE_COMMISSION = 0.05; // 5%
const POWER_KEY = 'mining:powers';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getMiners() {
    return this.prisma.miner.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  async buyMiner(userId: string, minerId: string) {
    const miner = await this.prisma.miner.findUnique({
      where: { id: minerId },
    });

    if (!miner || !miner.isActive) {
      throw new NotFoundException('Miner not found');
    }

    // Check coin balance
    const coinBalance = await this.prisma.coinBalance.findUnique({
      where: { userId },
    });

    if (!coinBalance || coinBalance.amount < miner.price) {
      throw new BadRequestException(
        `Insufficient coins. Need ${miner.price}, have ${coinBalance?.amount ?? 0}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Deduct coins
      await tx.coinBalance.update({
        where: { userId },
        data: { amount: { decrement: miner.price } },
      });

      // Create user miner
      const userMiner = await tx.userMiner.create({
        data: { userId, minerId: miner.id, isActive: true },
        include: { miner: true },
      });

      // Increment permanent power
      await tx.miningPower.upsert({
        where: { userId },
        update: { permanentPower: { increment: miner.basePower } },
        create: {
          userId,
          temporaryPower: 0,
          permanentPower: miner.basePower,
        },
      });

      return userMiner;
    });

    // Sync Redis
    await this.syncPowerToRedis(userId);

    this.logger.log(
      `User ${userId} bought miner ${miner.name} for ${miner.price} coins`,
    );

    return result;
  }

  async listMiner(userId: string, userMinerId: string, price: number) {
    const userMiner = await this.prisma.userMiner.findUnique({
      where: { id: userMinerId },
    });

    if (!userMiner) throw new NotFoundException('UserMiner not found');
    if (userMiner.userId !== userId) {
      throw new ForbiddenException('Not your miner');
    }
    if (!userMiner.isActive) {
      throw new BadRequestException('Miner is already listed or inactive');
    }

    // Check no existing active listing
    const existingListing = await this.prisma.marketplaceListing.findFirst({
      where: { userMinerId, status: 'ACTIVE' },
    });
    if (existingListing) {
      throw new BadRequestException('Miner is already listed');
    }

    if (price <= 0) {
      throw new BadRequestException('Price must be positive');
    }

    const listing = await this.prisma.$transaction(async (tx) => {
      // Deactivate the miner while listed
      await tx.userMiner.update({
        where: { id: userMinerId },
        data: { isActive: false },
      });

      return tx.marketplaceListing.create({
        data: {
          userMinerId,
          sellerId: userId,
          price,
          status: 'ACTIVE',
        },
        include: { userMiner: { include: { miner: true } } },
      });
    });

    this.logger.log(`User ${userId} listed miner ${userMinerId} for ${price} coins`);
    return listing;
  }

  async purchaseListing(buyerId: string, listingId: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { userMiner: { include: { miner: true } } },
    });

    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException('Listing not found or no longer active');
    }

    if (listing.sellerId === buyerId) {
      throw new BadRequestException('You cannot buy your own listing');
    }

    const price = listing.price;
    const commission = Math.floor(price * MARKETPLACE_COMMISSION);
    const sellerReceives = price - commission;

    // Check buyer's coin balance
    const buyerBalance = await this.prisma.coinBalance.findUnique({
      where: { userId: buyerId },
    });

    if (!buyerBalance || buyerBalance.amount < price) {
      throw new BadRequestException(
        `Insufficient coins. Need ${price}, have ${buyerBalance?.amount ?? 0}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Deduct buyer's coins
      await tx.coinBalance.update({
        where: { userId: buyerId },
        data: { amount: { decrement: price } },
      });

      // Credit seller (minus commission)
      await tx.coinBalance.upsert({
        where: { userId: listing.sellerId },
        update: { amount: { increment: sellerReceives } },
        create: { userId: listing.sellerId, amount: sellerReceives },
      });

      // Transfer the miner to buyer
      await tx.userMiner.update({
        where: { id: listing.userMinerId },
        data: { userId: buyerId, isActive: true },
      });

      // Close the listing
      await tx.marketplaceListing.update({
        where: { id: listingId },
        data: { status: 'SOLD', soldAt: new Date() },
      });

      // Subtract miner power from seller, add to buyer
      const miner = listing.userMiner.miner;

      await tx.miningPower.upsert({
        where: { userId: listing.sellerId },
        update: { permanentPower: { decrement: miner.basePower } },
        create: { userId: listing.sellerId, temporaryPower: 0, permanentPower: 0 },
      });

      await tx.miningPower.upsert({
        where: { userId: buyerId },
        update: { permanentPower: { increment: miner.basePower } },
        create: { userId: buyerId, temporaryPower: 0, permanentPower: miner.basePower },
      });
    });

    // Sync Redis for both users
    await Promise.all([
      this.syncPowerToRedis(listing.sellerId),
      this.syncPowerToRedis(buyerId),
    ]);

    this.logger.log(
      `User ${buyerId} purchased listing ${listingId} for ${price} coins`,
    );

    return { success: true, listingId, price, commission };
  }

  async getMyMiners(userId: string) {
    return this.prisma.userMiner.findMany({
      where: { userId },
      include: {
        miner: true,
        listings: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
      orderBy: { acquiredAt: 'desc' },
    });
  }

  async getListings() {
    return this.prisma.marketplaceListing.findMany({
      where: { status: 'ACTIVE' },
      include: {
        userMiner: { include: { miner: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async syncPowerToRedis(userId: string) {
    const mp = await this.prisma.miningPower.findUnique({ where: { userId } });
    if (mp) {
      const now = new Date();
      const tempExpired = mp.tempExpiresAt && mp.tempExpiresAt < now;
      const tempPower = tempExpired ? 0 : mp.temporaryPower;
      const totalPower = Math.max(0, tempPower + mp.permanentPower);
      await this.redis.hset(POWER_KEY, userId, String(totalPower));
    }
  }
}
