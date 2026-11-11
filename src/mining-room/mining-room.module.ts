import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MiningRoomService } from './mining-room.service.js';
import { MiningRoomController } from './mining-room.controller.js';

@Module({
  imports: [AuthModule],
  providers: [MiningRoomService],
  controllers: [MiningRoomController],
  exports: [MiningRoomService],
})
export class MiningRoomModule {}
