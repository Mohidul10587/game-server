import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomBytes } from 'crypto';

const SUPPORTED_CURRENCIES = ['BTC', 'ETH', 'SOL'];

/**
 * Generates a mock deposit address.
 * In production, this would call a blockchain API (e.g. Tatum, BitGo, or Fireblocks)
 * to derive a real HD wallet address.
 */
function generateMockAddress(currency: string): string {
  const randomHex = randomBytes(20).toString('hex');
  switch (currency) {
    case 'BTC':
      // P2WPKH format: bc1q + random
      return `bc1q${randomHex.substring(0, 38)}`;
    case 'ETH':
      // EIP-55 checksum format
      return `0x${randomBytes(20).toString('hex')}`;
    case 'SOL':
      // Base58-like (simplified mock)
      const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let addr = '';
      const bytes = randomBytes(32);
      for (const b of bytes) {
        addr += chars[b % chars.length];
      }
      return addr.substring(0, 44);
    default:
      return `${currency.toLowerCase()}_${randomHex.substring(0, 32)}`;
  }
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get or generate a deposit address for the user + currency.
   * Returns existing address if one already exists.
   */
  async getOrCreateDepositAddress(userId: string, currency: string) {
    const currencyUpper = currency.toUpperCase();

    if (!SUPPORTED_CURRENCIES.includes(currencyUpper)) {
      throw new BadRequestException(
        `Unsupported currency: ${currencyUpper}. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }

    const existing = await this.prisma.depositAddress.findUnique({
      where: { userId_currency: { userId, currency: currencyUpper } },
    });

    if (existing) {
      return {
        currency: existing.currency,
        address: existing.address,
        createdAt: existing.createdAt,
        isNew: false,
      };
    }

    // Generate new address (mock — replace with real blockchain API in production)
    const address = generateMockAddress(currencyUpper);

    const newAddr = await this.prisma.depositAddress.create({
      data: { userId, currency: currencyUpper, address },
    });

    this.logger.log(`Generated ${currencyUpper} deposit address for user ${userId}`);

    return {
      currency: newAddr.currency,
      address: newAddr.address,
      createdAt: newAddr.createdAt,
      isNew: true,
    };
  }

  /**
   * Get all deposit addresses for a user.
   */
  async getDepositAddresses(userId: string) {
    const addresses = await this.prisma.depositAddress.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return addresses.map((a) => ({
      id: a.id,
      currency: a.currency,
      address: a.address,
      createdAt: a.createdAt,
    }));
  }

  /**
   * Get deposit history for a user.
   */
  async getDepositHistory(userId: string) {
    return this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        currency: true,
        amount: true,
        txHash: true,
        status: true,
        confirmedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Simulate a deposit confirmation (webhook-style, for testing).
   * In production, this would be called by a blockchain node or indexer webhook.
   */
  async confirmDeposit(
    userId: string,
    currency: string,
    amount: number,
    txHash: string,
  ) {
    const currencyUpper = currency.toUpperCase();

    if (!SUPPORTED_CURRENCIES.includes(currencyUpper)) {
      throw new BadRequestException(`Unsupported currency: ${currencyUpper}`);
    }

    if (amount <= 0) {
      throw new BadRequestException('Deposit amount must be positive');
    }

    // Check deposit address exists
    const depositAddr = await this.prisma.depositAddress.findUnique({
      where: { userId_currency: { userId, currency: currencyUpper } },
    });

    if (!depositAddr) {
      throw new BadRequestException(
        'No deposit address found for this currency. Generate one first.',
      );
    }

    // Check for duplicate txHash
    const existing = await this.prisma.deposit.findUnique({
      where: { txHash },
    });
    if (existing) {
      throw new BadRequestException('Transaction already processed');
    }

    // Create deposit record + credit balance in transaction
    const deposit = await this.prisma.$transaction(async (tx) => {
      const dep = await tx.deposit.create({
        data: {
          depositAddressId: depositAddr.id,
          userId,
          currency: currencyUpper,
          amount,
          txHash,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });

      // Credit the user's crypto balance
      await tx.cryptoBalance.upsert({
        where: { userId_currency: { userId, currency: currencyUpper } },
        update: { amount: { increment: amount } },
        create: { userId, currency: currencyUpper, amount },
      });

      return dep;
    });

    this.logger.log(
      `Deposit confirmed: ${amount} ${currencyUpper} for user ${userId} (tx: ${txHash})`,
    );

    return {
      id: deposit.id,
      currency: deposit.currency,
      amount: Number(deposit.amount),
      txHash: deposit.txHash,
      status: deposit.status,
      confirmedAt: deposit.confirmedAt,
    };
  }
}
