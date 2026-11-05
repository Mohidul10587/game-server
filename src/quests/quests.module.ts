import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { QuestsService } from './quests.service.js';
import { QuestsController } from './quests.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [QuestsController],
  providers: [QuestsService],
  exports: [QuestsService],
})
export class QuestsModule {}
