import { IsString, IsIn } from 'class-validator';
import { GAME_CONFIG } from '../games.config.js';

export class StartGameDto {
  @IsString()
  @IsIn(Object.keys(GAME_CONFIG), {
    message: `gameType must be one of: ${Object.keys(GAME_CONFIG).join(', ')}`,
  })
  gameType: string;
}
