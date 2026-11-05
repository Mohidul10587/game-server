import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { QuestsService } from './quests.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('quests')
export class QuestsController {
  constructor(private questsService: QuestsService) {}

  @Get()
  getActiveQuests(@Request() req: { user: { id: string } }) {
    return this.questsService.getActiveQuests(req.user.id);
  }

  @Post(':questId/claim')
  claimReward(
    @Request() req: { user: { id: string } },
    @Param('questId') questId: string,
  ) {
    return this.questsService.claimReward(req.user.id, questId);
  }
}
