import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    // Check for duplicate email or username
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existing) {
      if (existing.email === dto.email) {
        throw new ConflictException('Email already in use');
      }
      throw new ConflictException('Username already taken');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Generate unique referral code
    const referralCode = await this.generateUniqueReferralCode();

    // Resolve referrer if code provided
    let referrer: { id: string } | null = null;
    if (dto.referralCode) {
      referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode },
        select: { id: true },
      });
      if (!referrer) {
        throw new BadRequestException('Invalid referral code');
      }
    }

    // Determine welcome bonus
    const welcomeBoins = referrer ? 2000 : 1000;

    // Create user + balances in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash,
          referralCode,
          referredBy: referrer?.id ?? null,
          miningPower: {
            create: {
              temporaryPower: 0,
              permanentPower: 0,
            },
          },
          coinBalance: {
            create: { amount: welcomeBoins },
          },
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          referralCode: true,
          createdAt: true,
        },
      });

      // Give BTC crypto balance record
      await tx.cryptoBalance.create({
        data: { userId: newUser.id, currency: 'BTC', amount: 0 },
      });

      // Handle referral reward
      if (referrer) {
        await tx.referral.create({
          data: { referrerId: referrer.id, referredId: newUser.id },
        });

        // Give referrer 500 coins bonus
        await tx.coinBalance.upsert({
          where: { userId: referrer.id },
          update: { amount: { increment: 500 } },
          create: { userId: referrer.id, amount: 500 },
        });
      }

      return newUser;
    });

    const token = this.signToken(user.id, user.email);
    this.logger.log(`New user registered: ${user.email}`);

    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) throw new UnauthorizedException('Invalid email or password');
    if (user.isBanned) throw new UnauthorizedException('Account is banned');

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Invalid email or password');

    const token = this.signToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatarUrl,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async getMe(userId: string) {
    const [user, totalGamesPlayed, minersOwned, rewardTotal] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          avatarUrl: true,
          referralCode: true,
          referredBy: true,
          createdAt: true,
          coinBalance: { select: { amount: true } },
          cryptoBalances: { select: { currency: true, amount: true } },
          miningPower: {
            select: {
              temporaryPower: true,
              permanentPower: true,
              tempExpiresAt: true,
            },
          },
        },
      }),
      // Total completed game sessions
      this.prisma.gameSession.count({
        where: { userId, status: 'COMPLETED' },
      }),
      // Total owned miners
      this.prisma.userMiner.count({
        where: { userId, isActive: true },
      }),
      // Sum of all BTC rewards ever earned
      this.prisma.rewardHistory.aggregate({
        where: { userId, currency: 'BTC' },
        _sum: { amount: true },
      }),
    ]);

    if (!user) throw new UnauthorizedException('User not found');

    // Current BTC balance from cryptoBalances
    const btcBalance = user.cryptoBalances.find((b) => b.currency === 'BTC');

    return {
      ...user,
      totalGamesPlayed,
      minersOwned,
      totalBtcEarned: rewardTotal._sum.amount ? Number(rewardTotal._sum.amount) : 0,
      btcBalance: btcBalance ? Number(btcBalance.amount) : 0,
    };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private async generateUniqueReferralCode(): Promise<string> {
    let code: string;
    let exists: boolean;

    do {
      code = uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase();
      const found = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      exists = !!found;
    } while (exists);

    return code;
  }
}
