import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { MiningRoomService } from './mining-room.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class PlaceMinerDto {
  @IsString()
  userMinerId: string;

  @IsInt()
  @Min(0)
  slotIndex: number;
}

@UseGuards(JwtAuthGuard)
@Controller('mining-room')
export class MiningRoomController {
  constructor(private miningRoomService: MiningRoomService) {}

  /** GET /api/mining-room — get user's room with all slots */
  @Get()
  getRoom(@Request() req: any) {
    return this.miningRoomService.getRoom(req.user.id);
  }

  /** GET /api/mining-room/unplaced — miners not in any slot */
  @Get('unplaced')
  getUnplaced(@Request() req: any) {
    return this.miningRoomService.getUnplacedMiners(req.user.id);
  }

  /** POST /api/mining-room/place — place a miner into a slot */
  @Post('place')
  placeMiner(@Request() req: any, @Body() dto: PlaceMinerDto) {
    return this.miningRoomService.placeMiner(
      req.user.id,
      dto.userMinerId,
      dto.slotIndex,
    );
  }

  /** DELETE /api/mining-room/unplace/:userMinerId — remove miner from slot */
  @Delete('unplace/:userMinerId')
  unplaceMiner(@Request() req: any, @Param('userMinerId') userMinerId: string) {
    return this.miningRoomService.unplaceMiner(req.user.id, userMinerId);
  }
}
