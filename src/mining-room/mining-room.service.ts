import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const POWER_KEY = 'mining:powers';
const TOTAL_ROOMS = 4;

@Injectable()
export class MiningRoomService {
  private readonly logger = new Logger(MiningRoomService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ═══════════════════════════════════════════
  // ROOM MANAGEMENT
  // ═══════════════════════════════════════════

  /**
   * Get all 4 rooms for a user (create if not exist).
   * Room 01 is auto-unlocked on first access.
   */
  async getRooms(userId: string) {
    await this.ensureRoomsExist(userId);

    const rooms = await this.prisma.miningRoom.findMany({
      where: { userId },
      orderBy: { roomNumber: 'asc' },
      include: {
        rackPlacements: {
          include: {
            rackProduct: true,
            rackInventory: true,
            minerPlacements: {
              include: {
                userMiner: { include: { miner: true } },
              },
            },
          },
        },
      },
    });

    // Enrich with room config (unlock costs)
    const configs = await this.prisma.roomConfig.findMany();
    const configMap = new Map(configs.map((c) => [c.roomNumber, c]));

    return rooms.map((r) => this.formatRoom(r, configMap.get(r.roomNumber)));
  }

  /**
   * Get a single room detail.
   */
  async getRoom(userId: string, roomNumber: number) {
    await this.ensureRoomsExist(userId);

    const room = await this.prisma.miningRoom.findUnique({
      where: { userId_roomNumber: { userId, roomNumber } },
      include: {
        rackPlacements: {
          include: {
            rackProduct: true,
            rackInventory: true,
            minerPlacements: {
              include: {
                userMiner: { include: { miner: true } },
              },
              orderBy: { slotIndex: 'asc' },
            },
          },
          orderBy: { slotIndex: 'asc' },
        },
      },
    });

    if (!room) throw new NotFoundException(`Room ${roomNumber} not found`);

    const config = await this.prisma.roomConfig.findUnique({
      where: { roomNumber },
    });

    return this.formatRoom(room, config ?? undefined);
  }

  /**
   * Unlock a room using coins.
   */
  async unlockRoom(userId: string, roomNumber: number) {
    if (roomNumber < 2 || roomNumber > 4) {
      throw new BadRequestException('Only rooms 2-4 can be unlocked');
    }

    await this.ensureRoomsExist(userId);

    const room = await this.prisma.miningRoom.findUnique({
      where: { userId_roomNumber: { userId, roomNumber } },
    });

    if (!room) throw new NotFoundException(`Room ${roomNumber} not found`);
    if (room.isUnlocked) throw new BadRequestException('Room is already unlocked');

    const config = await this.prisma.roomConfig.findUnique({
      where: { roomNumber },
    });

    const unlockCost = config?.unlockCost ?? room.unlockCost;

    // Check coin balance
    const coinBalance = await this.prisma.coinBalance.findUnique({
      where: { userId },
    });

    if (!coinBalance || coinBalance.amount < unlockCost) {
      throw new BadRequestException(
        `Insufficient coins. Need ${unlockCost}, have ${coinBalance?.amount ?? 0}`,
      );
    }

    // Deduct coins + unlock room in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.coinBalance.update({
        where: { userId },
        data: { amount: { decrement: unlockCost } },
      });

      await tx.miningRoom.update({
        where: { userId_roomNumber: { userId, roomNumber } },
        data: { isUnlocked: true, unlockCost },
      });
    });

    this.logger.log(`User ${userId} unlocked Room ${roomNumber} for ${unlockCost} coins`);

    return this.getRoom(userId, roomNumber);
  }

  // ═══════════════════════════════════════════
  // RACK PLACEMENT
  // ═══════════════════════════════════════════

  /**
   * Place a rack from inventory into a room slot.
   */
  async placeRack(userId: string, roomNumber: number, rackInventoryId: string, slotIndex: number) {
    // Verify room ownership + unlocked
    const room = await this.prisma.miningRoom.findUnique({
      where: { userId_roomNumber: { userId, roomNumber } },
    });

    if (!room) throw new NotFoundException(`Room ${roomNumber} not found`);
    if (!room.isUnlocked) throw new ForbiddenException('Room is locked. Unlock it first.');

    const maxSlots = room.gridCols * room.gridRows;
    if (slotIndex < 0 || slotIndex >= maxSlots) {
      throw new BadRequestException(`Invalid slot index. Must be 0–${maxSlots - 1}`);
    }

    // Verify rack ownership + not already placed
    const rackInv = await this.prisma.userRackInventory.findUnique({
      where: { id: rackInventoryId },
      include: { placement: true, rackProduct: true },
    });

    if (!rackInv) throw new NotFoundException('Rack not found in inventory');
    if (rackInv.userId !== userId) throw new ForbiddenException('Not your rack');
    if (rackInv.placement) throw new BadRequestException('Rack is already placed in a room');

    // Check target slot is empty
    const existingPlacement = await this.prisma.userRackPlacement.findUnique({
      where: { roomId_slotIndex: { roomId: room.id, slotIndex } },
    });

    if (existingPlacement) {
      throw new BadRequestException(`Slot ${slotIndex} is already occupied`);
    }

    const placement = await this.prisma.userRackPlacement.create({
      data: {
        userId,
        roomId: room.id,
        rackInventoryId,
        rackProductId: rackInv.rackProductId,
        slotIndex,
      },
      include: {
        rackProduct: true,
        minerPlacements: { include: { userMiner: { include: { miner: true } } } },
      },
    });

    this.logger.log(`User ${userId} placed rack ${rackInventoryId} in Room ${roomNumber} slot ${slotIndex}`);

    return this.formatRackPlacement(placement);
  }

  /**
   * Remove a rack from a room (returns to storage).
   * If rack has miners, they all return to storage too.
   */
  async removeRack(userId: string, rackPlacementId: string) {
    const placement = await this.prisma.userRackPlacement.findUnique({
      where: { id: rackPlacementId },
      include: { minerPlacements: true },
    });

    if (!placement) throw new NotFoundException('Rack placement not found');
    if (placement.userId !== userId) throw new ForbiddenException('Not your rack');

    // Delete the placement (cascade deletes miner placements too)
    await this.prisma.userRackPlacement.delete({ where: { id: rackPlacementId } });

    // Recalculate power (miners no longer placed)
    await this.recalculatePower(userId);

    this.logger.log(`User ${userId} removed rack placement ${rackPlacementId}`);

    return { success: true };
  }

  /**
   * Move a rack to a different slot in the same (or different unlocked) room.
   */
  async moveRack(userId: string, rackPlacementId: string, targetRoomNumber: number, targetSlotIndex: number) {
    const placement = await this.prisma.userRackPlacement.findUnique({
      where: { id: rackPlacementId },
      include: { room: true },
    });

    if (!placement) throw new NotFoundException('Rack placement not found');
    if (placement.userId !== userId) throw new ForbiddenException('Not your rack');

    // Verify target room
    const targetRoom = await this.prisma.miningRoom.findUnique({
      where: { userId_roomNumber: { userId, roomNumber: targetRoomNumber } },
    });

    if (!targetRoom) throw new NotFoundException(`Room ${targetRoomNumber} not found`);
    if (!targetRoom.isUnlocked) throw new ForbiddenException('Target room is locked');

    const maxSlots = targetRoom.gridCols * targetRoom.gridRows;
    if (targetSlotIndex < 0 || targetSlotIndex >= maxSlots) {
      throw new BadRequestException(`Invalid slot index`);
    }

    // Check target slot is empty (or same as current)
    const isSameSlot = placement.roomId === targetRoom.id && placement.slotIndex === targetSlotIndex;
    if (isSameSlot) throw new BadRequestException('Rack is already in this position');

    const occupying = await this.prisma.userRackPlacement.findUnique({
      where: { roomId_slotIndex: { roomId: targetRoom.id, slotIndex: targetSlotIndex } },
    });

    if (occupying) throw new BadRequestException(`Target slot ${targetSlotIndex} is occupied`);

    await this.prisma.userRackPlacement.update({
      where: { id: rackPlacementId },
      data: { roomId: targetRoom.id, slotIndex: targetSlotIndex },
    });

    this.logger.log(`User ${userId} moved rack ${rackPlacementId} to Room ${targetRoomNumber} slot ${targetSlotIndex}`);

    return this.getRoom(userId, targetRoomNumber);
  }

  // ═══════════════════════════════════════════
  // MINER PLACEMENT
  // ═══════════════════════════════════════════

  /**
   * Place a miner from storage into a rack slot.
   */
  async placeMinerInRack(userId: string, rackPlacementId: string, userMinerId: string, slotIndex: number) {
    // Verify rack placement ownership
    const rackPlacement = await this.prisma.userRackPlacement.findUnique({
      where: { id: rackPlacementId },
      include: {
        rackProduct: true,
        room: true,
        minerPlacements: true,
      },
    });

    if (!rackPlacement) throw new NotFoundException('Rack not found');
    if (rackPlacement.userId !== userId) throw new ForbiddenException('Not your rack');
    if (!rackPlacement.room.isUnlocked) throw new ForbiddenException('Room is locked');

    // Check capacity
    const capacity = rackPlacement.rackProduct.minerCapacity;
    if (rackPlacement.minerPlacements.length >= capacity) {
      throw new BadRequestException(`Rack is full (capacity: ${capacity})`);
    }

    if (slotIndex < 0 || slotIndex >= capacity) {
      throw new BadRequestException(`Invalid slot index. Must be 0–${capacity - 1}`);
    }

    // Check slot is empty
    const slotOccupied = rackPlacement.minerPlacements.find((m) => m.slotIndex === slotIndex);
    if (slotOccupied) throw new BadRequestException(`Rack slot ${slotIndex} is occupied`);

    // Verify miner ownership + not already placed
    const userMiner = await this.prisma.userMiner.findUnique({
      where: { id: userMinerId },
      include: {
        miner: true,
        minerPlacement: true,
        listings: { where: { status: 'ACTIVE' }, take: 1 },
      },
    });

    if (!userMiner) throw new NotFoundException('Miner not found');
    if (userMiner.userId !== userId) throw new ForbiddenException('Not your miner');
    if (!userMiner.isActive) throw new BadRequestException('Miner is inactive');
    if (userMiner.minerPlacement) throw new BadRequestException('Miner is already placed in a rack');
    if (userMiner.listings.length > 0) throw new BadRequestException('Miner is listed on marketplace');

    await this.prisma.userMinerPlacement.create({
      data: {
        userId,
        rackPlacementId,
        userMinerId,
        slotIndex,
      },
    });

    // Recalculate power
    await this.recalculatePower(userId);

    this.logger.log(`User ${userId} placed miner ${userMinerId} in rack ${rackPlacementId} slot ${slotIndex}`);

    return this.getRoom(userId, rackPlacement.room.roomNumber ?? 1);
  }

  /**
   * Remove a miner from a rack (returns to storage).
   */
  async removeMinerFromRack(userId: string, minerPlacementId: string) {
    const placement = await this.prisma.userMinerPlacement.findUnique({
      where: { id: minerPlacementId },
    });

    if (!placement) throw new NotFoundException('Miner placement not found');
    if (placement.userId !== userId) throw new ForbiddenException('Not your miner');

    await this.prisma.userMinerPlacement.delete({ where: { id: minerPlacementId } });

    // Recalculate power
    await this.recalculatePower(userId);

    this.logger.log(`User ${userId} removed miner placement ${minerPlacementId}`);

    return { success: true };
  }

  /**
   * Move miner to a different slot within same or different rack.
   */
  async moveMinerInRack(userId: string, minerPlacementId: string, targetRackPlacementId: string, targetSlotIndex: number) {
    const placement = await this.prisma.userMinerPlacement.findUnique({
      where: { id: minerPlacementId },
    });

    if (!placement) throw new NotFoundException('Miner placement not found');
    if (placement.userId !== userId) throw new ForbiddenException('Not your miner');

    // Verify target rack
    const targetRack = await this.prisma.userRackPlacement.findUnique({
      where: { id: targetRackPlacementId },
      include: { rackProduct: true, room: true, minerPlacements: true },
    });

    if (!targetRack) throw new NotFoundException('Target rack not found');
    if (targetRack.userId !== userId) throw new ForbiddenException('Not your rack');
    if (!targetRack.room.isUnlocked) throw new ForbiddenException('Target room is locked');

    // Check capacity if moving to different rack
    if (placement.rackPlacementId !== targetRackPlacementId) {
      if (targetRack.minerPlacements.length >= targetRack.rackProduct.minerCapacity) {
        throw new BadRequestException('Target rack is full');
      }
    }

    // Check target slot is empty
    const occupying = targetRack.minerPlacements.find(
      (m) => m.slotIndex === targetSlotIndex && m.id !== minerPlacementId,
    );
    if (occupying) throw new BadRequestException(`Target slot ${targetSlotIndex} is occupied`);

    await this.prisma.userMinerPlacement.update({
      where: { id: minerPlacementId },
      data: { rackPlacementId: targetRackPlacementId, slotIndex: targetSlotIndex },
    });

    this.logger.log(`User ${userId} moved miner placement ${minerPlacementId}`);

    return { success: true };
  }

  // ═══════════════════════════════════════════
  // STORAGE / INVENTORY
  // ═══════════════════════════════════════════

  /**
   * Get user's rack inventory (storage).
   */
  async getRackStorage(userId: string) {
    const inventory = await this.prisma.userRackInventory.findMany({
      where: { userId },
      include: {
        rackProduct: true,
        placement: {
          include: { room: true },
        },
      },
      orderBy: { acquiredAt: 'desc' },
    });

    return inventory.map((inv) => ({
      id: inv.id,
      rackProduct: {
        id: inv.rackProduct.id,
        name: inv.rackProduct.name,
        description: inv.rackProduct.description,
        imageUrl: inv.rackProduct.imageUrl,
        minerCapacity: inv.rackProduct.minerCapacity,
        rackType: inv.rackProduct.rackType,
      },
      acquiredAt: inv.acquiredAt,
      isPlaced: !!inv.placement,
      placement: inv.placement
        ? {
            id: inv.placement.id,
            roomNumber: inv.placement.room.roomNumber,
            slotIndex: inv.placement.slotIndex,
          }
        : null,
    }));
  }

  /**
   * Get user's miner inventory (storage — unplaced miners).
   */
  async getMinerStorage(userId: string) {
    const miners = await this.prisma.userMiner.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: {
        miner: true,
        minerPlacement: {
          include: {
            rackPlacement: {
              include: { room: true },
            },
          },
        },
        listings: { where: { status: 'ACTIVE' }, take: 1 },
      },
      orderBy: { acquiredAt: 'desc' },
    });

    return miners.map((um) => ({
      id: um.id,
      miner: {
        id: um.miner.id,
        name: um.miner.name,
        description: um.miner.description,
        imageUrl: um.miner.imageUrl,
        rarity: um.miner.rarity,
        basePower: um.miner.basePower,
        miningPower: um.miner.basePower,
        minerType: um.miner.minerType,
      },
      acquiredAt: um.acquiredAt,
      isPlaced: !!um.minerPlacement,
      isListed: um.listings.length > 0,
      placement: um.minerPlacement
        ? {
            id: um.minerPlacement.id,
            rackPlacementId: um.minerPlacement.rackPlacementId,
            slotIndex: um.minerPlacement.slotIndex,
            roomNumber: um.minerPlacement.rackPlacement.room.roomNumber,
          }
        : null,
    }));
  }

  // ═══════════════════════════════════════════
  // POWER RECALCULATION
  // ═══════════════════════════════════════════

  /**
   * Recalculate mining power from placed miners in unlocked rooms.
   * Only miners in: unlocked room → placed rack → active miner placement → isActive miner
   */
  async recalculatePower(userId: string): Promise<number> {
    const placements = await this.prisma.userMinerPlacement.findMany({
      where: {
        userId,
        rackPlacement: {
          room: {
            userId,
            isUnlocked: true,
          },
        },
        userMiner: { isActive: true },
      },
      include: {
        userMiner: { include: { miner: true } },
      },
    });

    const permanentPower = placements.reduce(
      (sum, p) => sum + (p.userMiner.miner.basePower ?? 0),
      0,
    );

    // Update DB
    await this.prisma.miningPower.upsert({
      where: { userId },
      update: { permanentPower },
      create: { userId, permanentPower, temporaryPower: 0 },
    });

    // Sync Redis
    const mp = await this.prisma.miningPower.findUnique({ where: { userId } });
    if (mp) {
      const now = new Date();
      const tempExpired = mp.tempExpiresAt && mp.tempExpiresAt < now;
      const totalPower = permanentPower + (tempExpired ? 0 : mp.temporaryPower);
      await this.redis.hset(POWER_KEY, userId, String(Math.max(0, totalPower)));
    }

    this.logger.log(`User ${userId} power recalculated: ${permanentPower} Gh/s`);

    return permanentPower;
  }

  // ═══════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════

  /**
   * Ensure all 4 rooms exist for a user. Room 1 auto-unlocked.
   */
  private async ensureRoomsExist(userId: string): Promise<void> {
    const existing = await this.prisma.miningRoom.findMany({
      where: { userId },
      select: { roomNumber: true },
    });

    const existingNumbers = new Set(existing.map((r) => r.roomNumber));
    const configs = await this.prisma.roomConfig.findMany();
    const configMap = new Map(configs.map((c) => [c.roomNumber, c]));

    const toCreate: Array<{
      userId: string;
      roomNumber: number;
      isUnlocked: boolean;
      unlockCost: number;
    }> = [];

    for (let i = 1; i <= TOTAL_ROOMS; i++) {
      if (!existingNumbers.has(i)) {
        const cfg = configMap.get(i);
        toCreate.push({
          userId,
          roomNumber: i,
          isUnlocked: i === 1,
          unlockCost: cfg?.unlockCost ?? (i === 1 ? 0 : i === 2 ? 5000 : i === 3 ? 15000 : 30000),
        });
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.miningRoom.createMany({ data: toCreate });
      this.logger.log(`Created ${toCreate.length} missing rooms for user ${userId}`);
    }
  }

  private formatRoom(room: any, config?: any) {
    const totalPower = room.rackPlacements
      ? room.rackPlacements.reduce((sum: number, rp: any) => {
          return (
            sum +
            rp.minerPlacements.reduce(
              (s: number, mp: any) => s + (mp.userMiner?.miner?.basePower ?? 0),
              0,
            )
          );
        }, 0)
      : 0;

    return {
      id: room.id,
      userId: room.userId,
      roomNumber: room.roomNumber,
      isUnlocked: room.isUnlocked,
      unlockCost: config?.unlockCost ?? room.unlockCost,
      name: config?.name ?? `Room ${String(room.roomNumber).padStart(2, '0')}`,
      gridCols: room.gridCols,
      gridRows: room.gridRows,
      maxSlots: room.gridCols * room.gridRows,
      rackPlacements: (room.rackPlacements ?? []).map((rp: any) =>
        this.formatRackPlacement(rp),
      ),
      activeRacks: (room.rackPlacements ?? []).length,
      totalPower,
      createdAt: room.createdAt,
    };
  }

  private formatRackPlacement(rp: any) {
    return {
      id: rp.id,
      slotIndex: rp.slotIndex,
      rackInventoryId: rp.rackInventoryId,
      rack: {
        id: rp.rackProduct?.id,
        name: rp.rackProduct?.name,
        imageUrl: rp.rackProduct?.imageUrl,
        minerCapacity: rp.rackProduct?.minerCapacity,
        rackType: rp.rackProduct?.rackType,
      },
      minerPlacements: (rp.minerPlacements ?? []).map((mp: any) => ({
        id: mp.id,
        slotIndex: mp.slotIndex,
        userMinerId: mp.userMinerId,
        miner: mp.userMiner
          ? {
              id: mp.userMiner.id,
              name: mp.userMiner.miner?.name,
              imageUrl: mp.userMiner.miner?.imageUrl,
              rarity: mp.userMiner.miner?.rarity,
              basePower: mp.userMiner.miner?.basePower,
              minerType: mp.userMiner.miner?.minerType,
            }
          : null,
      })),
      minerCount: (rp.minerPlacements ?? []).length,
      capacity: rp.rackProduct?.minerCapacity ?? 4,
      placedAt: rp.placedAt,
    };
  }
}
