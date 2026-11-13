import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { MiningRoomService } from './mining-room.service.js';
import { MiningRoomController } from './mining-room.controller.js';

@Module({
  imports: [AuthModule, RedisModule],
  providers: [MiningRoomService],
  controllers: [MiningRoomController],
  exports: [MiningRoomService],
})
export class MiningRoomModule {}
