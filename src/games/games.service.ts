import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { GAME_CONFIG } from './games.config.js';
import { StartGameDto } from './dto/start-game.dto.js';
import { CompleteGameDto } from './dto/complete-game.dto.js';

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);
  private readonly POWER_KEY = 'mining:powers';
  // Temporary power duration: 24 hours (as per game design)
  private readonly TEMP_POWER_TTL_MINUTES = 60 * 24; // 1440 minutes = 24 hours

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  getGames() {
    return Object.values(GAME_CONFIG);
  }

  async startGame(userId: string, dto: StartGameDto) {
    const config = GAME_CONFIG[dto.gameType];
    if (!config) throw new BadRequestException('Unknown game type');

    // Rate-limit check via Redis
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitKey = `ratelimit:game:${userId}:${dto.gameType}:${today}`;
    const countStr = await this.redis.get(rateLimitKey);
    const count = countStr ? parseInt(countStr, 10) : 0;

    if (count >= config.dailyLimit) {
      throw new BadRequestException(
        `Daily limit of ${config.dailyLimit} plays reached for ${config.name}`,
      );
    }

    const token = uuidv4();

    const session = await this.prisma.gameSession.create({
      data: {
        userId,
        gameType: dto.gameType,
        token,
        status: 'ACTIVE',
      },
    });

    this.logger.log(`Game started: ${dto.gameType} for user ${userId}`);
    return { sessionId: session.id, token, gameType: dto.gameType };
  }

  async completeGame(userId: string, dto: CompleteGameDto) {
    // Accept both 'token' and 'sessionToken' field names from frontend
    const sessionToken = dto.token ?? dto.sessionToken;
    if (!sessionToken) {
      throw new BadRequestException('Session token is required');
    }

    // Find the active session by token
    const session = await this.prisma.gameSession.findUnique({
      where: { token: sessionToken },
    });

    if (!session) throw new NotFoundException('Game session not found');
    if (session.userId !== userId) throw new BadRequestException('Not your session');
    if (session.status !== 'ACTIVE') {
      throw new BadRequestException('Game session is no longer active');
    }

    const config = GAME_CONFIG[session.gameType];
    if (!config) throw new BadRequestException('Unknown game type');

    // Validate score
    if (dto.score < 0 || dto.score > config.maxScore) {
      throw new BadRequestException(
        `Score must be between 0 and ${config.maxScore}`,
      );
    }

    // Calculate power earned
    const scorePercent = dto.score / config.maxScore;
    const powerEarned = Math.floor(scorePercent * config.maxPower);

    const now = new Date();
    const tempExpiresAt = new Date(
      now.getTime() + this.TEMP_POWER_TTL_MINUTES * 60 * 1000,
    );

    // Update session + mining power in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Mark session completed
      await tx.gameSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          score: dto.score,
          powerEarned,
          playedAt: now,
        },
      });

      // Upsert mining power — add temporary power
      await tx.miningPower.upsert({
        where: { userId },
        update: {
          temporaryPower: { increment: powerEarned },
          tempExpiresAt,
        },
        create: {
          userId,
          temporaryPower: powerEarned,
          permanentPower: 0,
          tempExpiresAt,
        },
      });
    });

    // Update Redis
    const mp = await this.prisma.miningPower.findUnique({ where: { userId } });
    if (mp) {
      const totalPower = mp.temporaryPower + mp.permanentPower;
      await this.redis.hset(this.POWER_KEY, userId, String(totalPower));
    }

    // Increment rate limit counter
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitKey = `ratelimit:game:${userId}:${session.gameType}:${today}`;
    const newCount = await this.redis.incr(rateLimitKey);
    if (newCount === 1) {
      // Set TTL to end of day
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const ttl = Math.floor((endOfDay.getTime() - Date.now()) / 1000);
      await this.redis.expire(rateLimitKey, ttl);
    }

    this.logger.log(
      `Game completed: ${session.gameType} for user ${userId}, score=${dto.score}, power=${powerEarned}`,
    );

    return {
      sessionId: session.id,
      gameType: session.gameType,
      score: dto.score,
      powerEarned,
      tempExpiresAt,
    };
  }

  async getHistory(userId: string) {
    return this.prisma.gameSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
