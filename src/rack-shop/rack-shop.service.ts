import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RackShopService {
  private readonly logger = new Logger(RackShopService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * List all active rack products.
   */
  async getRackProducts() {
    return this.prisma.rackProduct.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  /**
   * Get a single rack product by id.
   */
  async getRackProduct(id: string) {
    const product = await this.prisma.rackProduct.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Rack product not found');
    return product;
  }

  /**
   * Buy a rack — deduct coins and add to user inventory.
   * Uses DB transaction to prevent race conditions.
   */
  async buyRack(userId: string, rackProductId: string) {
    const product = await this.prisma.rackProduct.findUnique({
      where: { id: rackProductId },
    });

    if (!product || !product.isActive) {
      throw new NotFoundException('Rack product not found or not available');
    }

    // Check coin balance
    const coinBalance = await this.prisma.coinBalance.findUnique({
      where: { userId },
    });

    if (!coinBalance || coinBalance.amount < product.price) {
      throw new BadRequestException(
        `Insufficient coins. Need ${product.price}, have ${coinBalance?.amount ?? 0}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Deduct coins
      await tx.coinBalance.update({
        where: { userId },
        data: { amount: { decrement: product.price } },
      });

      // Add to inventory (1 rack per purchase)
      const inventory = await tx.userRackInventory.create({
        data: { userId, rackProductId: product.id },
        include: { rackProduct: true },
      });

      return inventory;
    });

    this.logger.log(`User ${userId} bought rack "${product.name}" for ${product.price} coins`);

    return {
      id: result.id,
      rackProduct: result.rackProduct,
      acquiredAt: result.acquiredAt,
      message: `Rack "${product.name}" added to your storage!`,
    };
  }
}
