import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

// Infrastructure
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { createBullRedisClient } from './redis/bull-redis-logger.js';

// Feature modules
import { AuthModule } from './auth/auth.module.js';
import { MiningModule } from './mining/mining.module.js';
import { GamesModule } from './games/games.module.js';
import { RewardModule } from './workers/reward.module.js';
import { MarketplaceModule } from './marketplace/marketplace.module.js';
import { QuestsModule } from './quests/quests.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { ReferralModule } from './referral/referral.module.js';
import { UploadModule } from './upload/upload.module.js';
import { AdminModule } from './admin/admin.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { UsersModule } from './users/users.module.js';
import { MailerModule } from './mailer/mailer.module.js';
import { PoolsModule } from './pools/pools.module.js';
import { MiningRoomModule } from './mining-room/mining-room.module.js';
import { WalletModule } from './wallet/wallet.module.js';

@Module({
  imports: [
    // Global env config — available everywhere without importing
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Bull queue — Upstash Redis TCP + TLS connection
    // ── Environment variable resolution ──────────────────────────────
    // Priority: UPSTASH_REDIS_* (preferred) → REDIS_* (fallback, matches .env)
    // No silent localhost fallback — throws if neither is set.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const host =
          config.get<string>('UPSTASH_REDIS_HOST') ??
          config.get<string>('REDIS_HOST');

        const portRaw =
          config.get<string>('UPSTASH_REDIS_PORT') ??
          config.get<string>('REDIS_PORT');

        const username =
          config.get<string>('UPSTASH_REDIS_USERNAME') ??
          config.get<string>('REDIS_USERNAME');

        const password =
          config.get<string>('UPSTASH_REDIS_PASSWORD') ??
          config.get<string>('REDIS_PASSWORD');

        if (!host) {
          throw new Error(
            '[Bull Redis] Missing required env var: set UPSTASH_REDIS_HOST or REDIS_HOST. ' +
              'No silent localhost fallback in production.',
          );
        }
        if (!password) {
          throw new Error(
            '[Bull Redis] Missing required env var: set UPSTASH_REDIS_PASSWORD or REDIS_PASSWORD.',
          );
        }

        const port = Number(portRaw) || 6379;

        return {
          // Custom client creation — MUST be at top level, NOT inside
          // `redis: {}`. Bull reads `options.createClient` in
          // redisClientGetter (queue.js:290), not
          // `options.redis.createClient`. Placing it inside `redis`
          // silently falls back to Bull's default createClient,
          // bypassing our enableOfflineQueue override for bclient.
          createClient: (
            type: 'client' | 'subscriber' | 'bclient',
            redisOpts: Record<string, unknown>,
          ) => createBullRedisClient(type, redisOpts),
          redis: {
            host,
            port,
            username: username || undefined,
            password,
            // Upstash TCP endpoints require TLS (rediss:// equivalent).
            // `tls: {}` enables the default TLS handshake.
            tls: {},
            // Production retry: stop after 10 attempts, backoff up to 3s
            retryStrategy: (times: number) => {
              if (times > 10) return null; // stop retrying, don't crash
              return Math.min(times * 300, 3000);
            },
            maxRetriesPerRequest: 3,
            // When the connection is down, reject commands immediately
            // instead of silently queueing them. This applies to the
            // 'client' (commands) and 'subscriber' connections only —
            // our custom createClient (bull-redis-logger.ts) overrides
            // enableOfflineQueue: true for 'bclient', because Bull's
            // setWorkerName() sends a command to bclient before it's
            // fully connected (Bull design limitation in v4.16.5).
            enableOfflineQueue: false,
            connectTimeout: 10_000,
          },
        };
      },
      inject: [ConfigService],
    }),

    // Infrastructure (global)
    PrismaModule,
    RedisModule,

    // Feature modules
    AuthModule,
    MiningModule,
    GamesModule,
    RewardModule,
    MarketplaceModule,
    QuestsModule,
    LeaderboardModule,
    ReferralModule,
    UploadModule,
    AdminModule,
    GatewayModule,
    UsersModule,
    MailerModule,
    PoolsModule,
    MiningRoomModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
