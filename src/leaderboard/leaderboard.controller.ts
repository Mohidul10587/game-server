import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private leaderboardService: LeaderboardService) {}

  @Get('top')
  getTop100() {
    return this.leaderboardService.getTop100();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-rank')
  getMyRank(@Request() req: { user: { id: string } }) {
    return this.leaderboardService.getMyRank(req.user.id);
  }
}
