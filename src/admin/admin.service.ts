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

  // ═══════════════════════════════════════════
  // WITHDRAWALS
  // ═══════════════════════════════════════════

  async getPendingWithdrawals() {
    return this.prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { id: true, username: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveWithdrawal(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') {
      throw new BadRequestException(`Withdrawal is already ${withdrawal.status}`);
    }

    return this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'APPROVED', processedAt: new Date() },
    });
  }

  async rejectWithdrawal(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== 'PENDING') {
      throw new BadRequestException(`Withdrawal is already ${withdrawal.status}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', processedAt: new Date() },
      });

      await tx.cryptoBalance.upsert({
        where: { userId_currency: { userId: withdrawal.userId, currency: withdrawal.currency } },
        update: { amount: { increment: withdrawal.amount } },
        create: { userId: withdrawal.userId, currency: withdrawal.currency, amount: withdrawal.amount },
      });
    });

    return { success: true };
  }

  // ═══════════════════════════════════════════
  // REWARD CONFIG
  // ═══════════════════════════════════════════

  async getRewardConfig() {
    const [config, pools] = await Promise.all([
      this.prisma.rewardConfig.findFirst(),
      this.prisma.pool.findMany({ where: { isActive: true }, orderBy: { currency: 'asc' } }),
    ]);

    return {
      global: config ?? { id: null, poolAmountPerCycle: 50000, cycleMinutes: 10, updatedAt: new Date() },
      pools: pools.map((p) => ({
        id: p.id, name: p.name, currency: p.currency,
        poolAmountPerCycle: Number(p.poolAmountPerCycle), isActive: p.isActive,
      })),
    };
  }

  async updateRewardConfig(poolAmountPerCycle?: number, cycleMinutes?: number) {
    if (poolAmountPerCycle !== undefined && poolAmountPerCycle <= 0) {
      throw new BadRequestException('Pool amount must be positive');
    }
    const existing = await this.prisma.rewardConfig.findFirst();
    if (!existing) {
      return this.prisma.rewardConfig.create({
        data: { poolAmountPerCycle: poolAmountPerCycle ?? 50000, cycleMinutes: cycleMinutes ?? 10 },
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

  async updatePoolConfig(poolId: string, poolAmountPerCycle?: number, isActive?: boolean) {
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) throw new NotFoundException('Pool not found');

    const updated = await this.prisma.pool.update({
      where: { id: poolId },
      data: {
        ...(poolAmountPerCycle !== undefined && { poolAmountPerCycle }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return { id: updated.id, name: updated.name, currency: updated.currency, poolAmountPerCycle: Number(updated.poolAmountPerCycle), isActive: updated.isActive };
  }

  async getPoolStats() {
    const pools = await this.prisma.pool.findMany({
      orderBy: { currency: 'asc' },
      include: { _count: { select: { allocations: true } } },
    });
    return pools.map((pool) => ({
      id: pool.id, name: pool.name, currency: pool.currency,
      poolAmountPerCycle: Number(pool.poolAmountPerCycle), isActive: pool.isActive,
      participantCount: pool._count.allocations,
    }));
  }

  // ═══════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════

  async banUser(userId: string, ban: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new BadRequestException('Cannot ban an admin user');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: ban },
      select: { id: true, username: true, isBanned: true },
    });
  }

  async getUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true, username: true, email: true, role: true, isBanned: true, createdAt: true,
        miningPower: { select: { permanentPower: true, temporaryPower: true } },
        cryptoBalances: { select: { currency: true, amount: true } },
        _count: { select: { gameSessionss: true, withdrawals: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDashboardStats() {
    const [users, activePowers, pendingWithdrawals, totalRacks, totalMiners] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.miningPower.aggregate({
        _sum: { permanentPower: true, temporaryPower: true },
      }),
      this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      this.prisma.userRackInventory.count(),
      this.prisma.userMiner.count({ where: { isActive: true } }),
    ]);

    return {
      totalUsers: users,
      totalPermanentPower: activePowers._sum.permanentPower ?? 0,
      totalTemporaryPower: activePowers._sum.temporaryPower ?? 0,
      pendingWithdrawals,
      totalRacks,
      totalMiners,
    };
  }

  // ═══════════════════════════════════════════
  // MINER PRODUCTS (admin CRUD)
  // ═══════════════════════════════════════════

  async getMinerProducts() {
    return this.prisma.miner.findMany({ orderBy: { price: 'asc' } });
  }

  async createMinerProduct(data: {
    name: string;
    description?: string;
    rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
    basePower: number;
    price: number;
    imageUrl: string;
    minerType?: string;
  }) {
    return this.prisma.miner.create({
      data: {
        name: data.name,
        description: data.description,
        rarity: data.rarity,
        basePower: data.basePower,
        miningPower: data.basePower,
        price: data.price,
        imageUrl: data.imageUrl,
        minerType: data.minerType ?? 'standard',
        isActive: true,
      },
    });
  }

  async updateMinerProduct(id: string, data: {
    name?: string;
    description?: string;
    basePower?: number;
    price?: number;
    imageUrl?: string;
    minerType?: string;
    isActive?: boolean;
  }) {
    const miner = await this.prisma.miner.findUnique({ where: { id } });
    if (!miner) throw new NotFoundException('Miner product not found');

    return this.prisma.miner.update({
      where: { id },
      data: {
        ...data,
        ...(data.basePower !== undefined && { miningPower: data.basePower }),
      },
    });
  }

  async deactivateMinerProduct(id: string) {
    const miner = await this.prisma.miner.findUnique({ where: { id } });
    if (!miner) throw new NotFoundException('Miner product not found');

    return this.prisma.miner.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ═══════════════════════════════════════════
  // RACK PRODUCTS (admin CRUD)
  // ═══════════════════════════════════════════

  async getRackProducts() {
    return this.prisma.rackProduct.findMany({ orderBy: { price: 'asc' } });
  }

  async createRackProduct(data: {
    name: string;
    description?: string;
    imageUrl?: string;
    price: number;
    minerCapacity: number;
    rackType?: string;
  }) {
    return this.prisma.rackProduct.create({
      data: {
        name: data.name,
        description: data.description,
        imageUrl: data.imageUrl ?? '/assets/racks/rack-basic.svg',
        price: data.price,
        minerCapacity: data.minerCapacity,
        rackType: data.rackType ?? 'basic',
        isActive: true,
      },
    });
  }

  async updateRackProduct(id: string, data: {
    name?: string;
    description?: string;
    imageUrl?: string;
    price?: number;
    minerCapacity?: number;
    rackType?: string;
    isActive?: boolean;
  }) {
    const rack = await this.prisma.rackProduct.findUnique({ where: { id } });
    if (!rack) throw new NotFoundException('Rack product not found');

    return this.prisma.rackProduct.update({ where: { id }, data });
  }

  async deactivateRackProduct(id: string) {
    const rack = await this.prisma.rackProduct.findUnique({ where: { id } });
    if (!rack) throw new NotFoundException('Rack product not found');

    return this.prisma.rackProduct.update({ where: { id }, data: { isActive: false } });
  }

  // ═══════════════════════════════════════════
  // ROOM CONFIG (admin management)
  // ═══════════════════════════════════════════

  async getRoomConfigs() {
    return this.prisma.roomConfig.findMany({ orderBy: { roomNumber: 'asc' } });
  }

  async updateRoomConfig(roomNumber: number, data: {
    unlockCost?: number;
    name?: string;
    isActive?: boolean;
  }) {
    if (roomNumber < 1 || roomNumber > 4) {
      throw new BadRequestException('Room number must be 1-4');
    }

    const config = await this.prisma.roomConfig.findUnique({ where: { roomNumber } });
    if (!config) throw new NotFoundException(`Room ${roomNumber} config not found`);

    const updated = await this.prisma.roomConfig.update({
      where: { roomNumber },
      data,
    });

    this.logger.log(`Admin updated Room ${roomNumber} config`);
    return updated;
  }
}
