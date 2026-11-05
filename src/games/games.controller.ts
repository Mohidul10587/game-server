import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GamesService } from './games.service.js';
import { CompleteGameDto } from './dto/complete-game.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('games')
export class GamesController {
  constructor(private gamesService: GamesService) {}

  // GET /api/games — list all games
  @Get()
  getGames() {
    return this.gamesService.getGames();
  }

  // GET /api/games/history — play history
  @Get('history')
  getHistory(@Request() req: { user: { id: string } }) {
    return this.gamesService.getHistory(req.user.id);
  }

  // POST /api/games/:gameId/start — frontend uses this pattern
  @Post(':gameId/start')
  startGame(
    @Request() req: { user: { id: string } },
    @Param('gameId') gameId: string,
  ) {
    return this.gamesService.startGame(req.user.id, { gameType: gameId });
  }

  // POST /api/games/:gameId/complete — frontend uses this pattern
  @Post(':gameId/complete')
  completeGame(
    @Request() req: { user: { id: string } },
    @Param('gameId') gameId: string,
    @Body() dto: CompleteGameDto,
  ) {
    return this.gamesService.completeGame(req.user.id, dto);
  }

  // POST /api/games/start — legacy route (body: { gameType })
  @Post('start')
  startGameLegacy(
    @Request() req: { user: { id: string } },
    @Body() body: { gameType: string },
  ) {
    return this.gamesService.startGame(req.user.id, { gameType: body.gameType });
  }

  // POST /api/games/complete — legacy route
  @Post('complete')
  completeGameLegacy(
    @Request() req: { user: { id: string } },
    @Body() dto: CompleteGameDto,
  ) {
    return this.gamesService.completeGame(req.user.id, dto);
  }
}
