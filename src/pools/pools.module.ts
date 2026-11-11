import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PoolsService } from './pools.service.js';
import { PoolsController } from './pools.controller.js';

@Module({
  imports: [AuthModule],
  providers: [PoolsService],
  controllers: [PoolsController],
  exports: [PoolsService],
})
export class PoolsModule {}
