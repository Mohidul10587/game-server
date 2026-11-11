import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PoolsService {
  private readonly logger = new Logger(PoolsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all active pools with current stats (total allocated power per pool).
   */
  async getPools() {
    const pools = await this.prisma.pool.findMany({
      where: { isActive: true },
      orderBy: { currency: 'asc' },
      include: {
        _count: { select: { allocations: true } },
      },
    });

    return pools.map((pool) => ({
      id: pool.id,
      name: pool.name,
      currency: pool.currency,
      poolAmountPerCycle: Number(pool.poolAmountPerCycle),
      isActive: pool.isActive,
      participantCount: pool._count.allocations,
    }));
  }

  /**
   * Get pool stats including user's current allocation.
   */
  async getPoolStats(poolId: string, userId: string) {
    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
    });

    if (!pool) throw new NotFoundException('Pool not found');

    const [totalAllocatedResult, userAllocation] = await Promise.all([
      this.prisma.userPoolAllocation.aggregate({
        where: { poolId },
        _sum: { powerPercent: true },
      }),
      this.prisma.userPoolAllocation.findUnique({
        where: { userId_poolId: { userId, poolId } },
      }),
    ]);

    return {
      pool: {
        id: pool.id,
        name: pool.name,
        currency: pool.currency,
        poolAmountPerCycle: Number(pool.poolAmountPerCycle),
      },
      totalAllocatedPercent: Number(totalAllocatedResult._sum.powerPercent ?? 0),
      userPowerPercent: userAllocation ? Number(userAllocation.powerPercent) : 0,
    };
  }

  /**
   * Get user's current pool allocations (all pools).
   */
  async getUserAllocations(userId: string) {
    const pools = await this.prisma.pool.findMany({
      where: { isActive: true },
      orderBy: { currency: 'asc' },
    });

    const allocations = await this.prisma.userPoolAllocation.findMany({
      where: { userId },
    });

    const allocationMap = new Map(allocations.map((a) => [a.poolId, Number(a.powerPercent)]));

    return pools.map((pool) => ({
      poolId: pool.id,
      poolName: pool.name,
      currency: pool.currency,
      poolAmountPerCycle: Number(pool.poolAmountPerCycle),
      powerPercent: allocationMap.get(pool.id) ?? 0,
    }));
  }

  /**
   * Set power allocation percentages across pools.
   * Input: array of { poolId, powerPercent }
   * Total must not exceed 100%.
   */
  async setAllocations(
    userId: string,
    allocations: Array<{ poolId: string; powerPercent: number }>,
  ) {
    // Validate total <= 100
    const total = allocations.reduce((sum, a) => sum + a.powerPercent, 0);
    if (total > 100.01) {
      // small epsilon for floating point
      throw new BadRequestException(
        `Total allocation (${total.toFixed(2)}%) cannot exceed 100%`,
      );
    }

    if (allocations.some((a) => a.powerPercent < 0)) {
      throw new BadRequestException('Allocation percentages cannot be negative');
    }

    // Validate all poolIds exist
    const poolIds = allocations.map((a) => a.poolId);
    const existingPools = await this.prisma.pool.findMany({
      where: { id: { in: poolIds }, isActive: true },
      select: { id: true },
    });

    if (existingPools.length !== poolIds.length) {
      throw new BadRequestException('One or more pool IDs are invalid or inactive');
    }

    // Upsert all allocations in a transaction
    await this.prisma.$transaction(
      allocations.map((a) =>
        this.prisma.userPoolAllocation.upsert({
          where: { userId_poolId: { userId, poolId: a.poolId } },
          update: { powerPercent: a.powerPercent },
          create: { userId, poolId: a.poolId, powerPercent: a.powerPercent },
        }),
      ),
    );

    this.logger.log(
      `User ${userId} updated allocations: ${allocations.map((a) => `${a.poolId}=${a.powerPercent}%`).join(', ')}`,
    );

    return this.getUserAllocations(userId);
  }

  /**
   * Quick-allocate: evenly split total power across all active pools.
   */
  async evenSplit(userId: string) {
    const pools = await this.prisma.pool.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (pools.length === 0) throw new BadRequestException('No active pools found');

    const percentEach = parseFloat((100 / pools.length).toFixed(2));
    const allocations = pools.map((p) => ({ poolId: p.id, powerPercent: percentEach }));

    return this.setAllocations(userId, allocations);
  }
}
