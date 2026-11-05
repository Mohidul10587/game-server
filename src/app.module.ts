import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

// Infrastructure
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

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

@Module({
  imports: [
    // Global env config — available everywhere without importing
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Bull queue — Upstash Redis TCP + TLS connection
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('UPSTASH_REDIS_HOST'),
          port: config.get<number>('UPSTASH_REDIS_PORT', 6379),
          password: config.get<string>('UPSTASH_REDIS_PASSWORD'),
          tls: {}, // Upstash requires TLS — cannot be disabled
          // Production retry: stop after 10 attempts, backoff up to 3s
          retryStrategy: (times: number) => {
            if (times > 10) return null; // stop retrying, don't crash
            return Math.min(times * 300, 3000);
          },
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          connectTimeout: 10_000,
        },
      }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
