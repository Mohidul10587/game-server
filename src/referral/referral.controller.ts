import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ReferralService } from './referral.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('referral')
export class ReferralController {
  constructor(private referralService: ReferralService) {}

  @Get('stats')
  getReferralStats(@Request() req: { user: { id: string } }) {
    return this.referralService.getReferralStats(req.user.id);
  }

  @Get('link')
  getReferralLink(@Request() req: { user: { id: string } }) {
    return this.referralService.getReferralLink(req.user.id);
  }

  @Get('list')
  getReferralList(@Request() req: { user: { id: string } }) {
    return this.referralService.getReferralList(req.user.id);
  }
}
