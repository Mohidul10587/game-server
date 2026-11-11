import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_TOTAL_SLOTS = 9;

@Injectable()
export class MiningRoomService {
  private readonly logger = new Logger(MiningRoomService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get or create the user's mining room, ensuring all slots are initialized.
   */
  async getRoom(userId: string) {
    let room = await this.prisma.miningRoom.findUnique({
      where: { userId },
      include: {
        slots: {
          include: {
            userMiner: {
              include: { miner: true },
            },
          },
          orderBy: { slotIndex: 'asc' },
        },
      },
    });

    if (!room) {
      // Create room with empty slots
      room = await this.prisma.miningRoom.create({
        data: {
          userId,
          totalSlots: DEFAULT_TOTAL_SLOTS,
          slots: {
            createMany: {
              data: Array.from({ length: DEFAULT_TOTAL_SLOTS }, (_, i) => ({
                slotIndex: i,
              })),
            },
          },
        },
        include: {
          slots: {
            include: {
              userMiner: {
                include: { miner: true },
              },
            },
            orderBy: { slotIndex: 'asc' },
          },
        },
      });

      this.logger.log(`Created mining room for user ${userId} with ${DEFAULT_TOTAL_SLOTS} slots`);
    }

    return this.formatRoom(room);
  }

  /**
   * Place a miner into a specific slot.
   */
  async placeMiner(userId: string, userMinerId: string, slotIndex: number) {
    // Ensure user owns this miner and it exists
    const userMiner = await this.prisma.userMiner.findFirst({
      where: { id: userMinerId, userId, isActive: true },
      include: { miner: true },
    });

    if (!userMiner) {
      throw new NotFoundException('Miner not found or not owned by you');
    }

    // Check miner is not already in marketplace
    const activeListing = await this.prisma.marketplaceListing.findFirst({
      where: { userMinerId, status: 'ACTIVE' },
    });
    if (activeListing) {
      throw new BadRequestException('Cannot place a miner that is listed on the marketplace');
    }

    // Get or create room
    await this.ensureRoom(userId);

    const room = await this.prisma.miningRoom.findUnique({ where: { userId } });
    if (!room) throw new NotFoundException('Mining room not found');

    if (slotIndex < 0 || slotIndex >= room.totalSlots) {
      throw new BadRequestException(
        `Invalid slot index. Must be between 0 and ${room.totalSlots - 1}`,
      );
    }

    // Check if miner is already in another slot — unplace it first
    const existingSlot = await this.prisma.minerSlot.findUnique({
      where: { userMinerId },
    });

    if (existingSlot && existingSlot.slotIndex === slotIndex) {
      throw new BadRequestException('Miner is already in this slot');
    }

    // Check target slot is empty
    const targetSlot = await this.prisma.minerSlot.findUnique({
      where: { roomId_slotIndex: { roomId: room.id, slotIndex } },
    });

    if (!targetSlot) throw new NotFoundException('Slot not found');
    if (targetSlot.userMinerId !== null) {
      throw new BadRequestException(`Slot ${slotIndex} is already occupied`);
    }

    // Place the miner (and clear old slot if needed)
    await this.prisma.$transaction(async (tx) => {
      // Clear existing slot if miner was placed somewhere
      if (existingSlot) {
        await tx.minerSlot.update({
          where: { id: existingSlot.id },
          data: { userMinerId: null, placedAt: null },
        });
      }

      // Place into new slot
      await tx.minerSlot.update({
        where: { roomId_slotIndex: { roomId: room.id, slotIndex } },
        data: { userMinerId, placedAt: new Date() },
      });
    });

    this.logger.log(
      `User ${userId} placed miner ${userMinerId} in slot ${slotIndex}`,
    );

    return this.getRoom(userId);
  }

  /**
   * Remove a miner from its current slot.
   */
  async unplaceMiner(userId: string, userMinerId: string) {
    // Verify ownership
    const userMiner = await this.prisma.userMiner.findFirst({
      where: { id: userMinerId, userId },
    });

    if (!userMiner) {
      throw new NotFoundException('Miner not found or not owned by you');
    }

    const slot = await this.prisma.minerSlot.findUnique({
      where: { userMinerId },
    });

    if (!slot) {
      throw new BadRequestException('Miner is not placed in any slot');
    }

    await this.prisma.minerSlot.update({
      where: { id: slot.id },
      data: { userMinerId: null, placedAt: null },
    });

    this.logger.log(`User ${userId} removed miner ${userMinerId} from slot ${slot.slotIndex}`);

    return this.getRoom(userId);
  }

  /**
   * Get list of user's miners that are NOT placed in any slot.
   */
  async getUnplacedMiners(userId: string) {
    const userMiners = await this.prisma.userMiner.findMany({
      where: {
        userId,
        isActive: true,
        slot: null, // no slot assigned
        listings: { none: { status: 'ACTIVE' } }, // not in marketplace
      },
      include: { miner: true },
      orderBy: { acquiredAt: 'asc' },
    });

    return userMiners.map((um) => ({
      id: um.id,
      minerId: um.minerId,
      name: um.miner.name,
      rarity: um.miner.rarity,
      basePower: um.miner.basePower,
      imageUrl: um.miner.imageUrl,
      acquiredAt: um.acquiredAt,
    }));
  }

  private async ensureRoom(userId: string): Promise<void> {
    const existing = await this.prisma.miningRoom.findUnique({ where: { userId } });
    if (!existing) {
      await this.prisma.miningRoom.create({
        data: {
          userId,
          totalSlots: DEFAULT_TOTAL_SLOTS,
          slots: {
            createMany: {
              data: Array.from({ length: DEFAULT_TOTAL_SLOTS }, (_, i) => ({
                slotIndex: i,
              })),
            },
          },
        },
      });
    }
  }

  private formatRoom(room: any) {
    return {
      id: room.id,
      userId: room.userId,
      totalSlots: room.totalSlots,
      slots: room.slots.map((slot: any) => ({
        id: slot.id,
        slotIndex: slot.slotIndex,
        isEmpty: slot.userMinerId === null,
        placedAt: slot.placedAt,
        miner: slot.userMiner
          ? {
              id: slot.userMiner.id,
              minerId: slot.userMiner.minerId,
              name: slot.userMiner.miner.name,
              rarity: slot.userMiner.miner.rarity,
              basePower: slot.userMiner.miner.basePower,
              imageUrl: slot.userMiner.miner.imageUrl,
            }
          : null,
      })),
      activeMiners: room.slots.filter((s: any) => s.userMinerId !== null).length,
      emptySlots: room.slots.filter((s: any) => s.userMinerId === null).length,
    };
  }
}
