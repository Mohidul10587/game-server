import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MiningService } from './mining.service.js';
import { MiningController } from './mining.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MiningController],
  providers: [MiningService],
  exports: [MiningService],
})
export class MiningModule {}
