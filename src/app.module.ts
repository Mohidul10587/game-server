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

    // BullMQ root config — uses Redis connection from ConfigService
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
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
