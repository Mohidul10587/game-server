import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReferralService } from './referral.service.js';
import { ReferralController } from './referral.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ReferralController],
  providers: [ReferralService],
})
export class ReferralModule {}
