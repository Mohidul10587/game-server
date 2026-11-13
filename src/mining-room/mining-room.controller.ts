import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
} from 'class-validator';
import { MiningRoomService } from './mining-room.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class PlaceRackDto {
  @IsString()
  rackInventoryId: string;

  @IsInt()
  @Min(0)
  slotIndex: number;
}

class MoveRackDto {
  @IsInt()
  @Min(1)
  @Max(4)
  targetRoomNumber: number;

  @IsInt()
  @Min(0)
  targetSlotIndex: number;
}

class PlaceMinerDto {
  @IsString()
  userMinerId: string;

  @IsInt()
  @Min(0)
  slotIndex: number;
}

class MoveMinerDto {
  @IsString()
  targetRackPlacementId: string;

  @IsInt()
  @Min(0)
  targetSlotIndex: number;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@UseGuards(JwtAuthGuard)
@Controller('mining-room')
export class MiningRoomController {
  constructor(private readonly service: MiningRoomService) {}

  // ───── ROOMS ─────────────────────────────────────────────────────────────

  /** GET /api/mining-room/rooms — all 4 rooms with placements */
  @Get('rooms')
  getRooms(@Request() req: any) {
    return this.service.getRooms(req.user.id);
  }

  /** GET /api/mining-room/rooms/:roomNumber — single room detail */
  @Get('rooms/:roomNumber')
  getRoom(
    @Request() req: any,
    @Param('roomNumber', ParseIntPipe) roomNumber: number,
  ) {
    return this.service.getRoom(req.user.id, roomNumber);
  }

  /** POST /api/mining-room/rooms/:roomNumber/unlock — unlock a room with coins */
  @Post('rooms/:roomNumber/unlock')
  @HttpCode(HttpStatus.OK)
  unlockRoom(
    @Request() req: any,
    @Param('roomNumber', ParseIntPipe) roomNumber: number,
  ) {
    return this.service.unlockRoom(req.user.id, roomNumber);
  }

  // ───── RACK PLACEMENTS ────────────────────────────────────────────────────

  /** POST /api/mining-room/rooms/:roomNumber/racks — place rack in room */
  @Post('rooms/:roomNumber/racks')
  placeRack(
    @Request() req: any,
    @Param('roomNumber', ParseIntPipe) roomNumber: number,
    @Body() dto: PlaceRackDto,
  ) {
    return this.service.placeRack(req.user.id, roomNumber, dto.rackInventoryId, dto.slotIndex);
  }

  /** DELETE /api/mining-room/rack-placements/:id — remove rack (back to storage) */
  @Delete('rack-placements/:id')
  @HttpCode(HttpStatus.OK)
  removeRack(@Request() req: any, @Param('id') id: string) {
    return this.service.removeRack(req.user.id, id);
  }

  /** PATCH /api/mining-room/rack-placements/:id/move — move rack to another slot */
  @Patch('rack-placements/:id/move')
  moveRack(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: MoveRackDto,
  ) {
    return this.service.moveRack(req.user.id, id, dto.targetRoomNumber, dto.targetSlotIndex);
  }

  // ───── MINER PLACEMENTS ───────────────────────────────────────────────────

  /** POST /api/mining-room/rack-placements/:id/miners — place miner in rack */
  @Post('rack-placements/:id/miners')
  placeMiner(
    @Request() req: any,
    @Param('id') rackPlacementId: string,
    @Body() dto: PlaceMinerDto,
  ) {
    return this.service.placeMinerInRack(req.user.id, rackPlacementId, dto.userMinerId, dto.slotIndex);
  }

  /** DELETE /api/mining-room/miner-placements/:id — remove miner from rack */
  @Delete('miner-placements/:id')
  @HttpCode(HttpStatus.OK)
  removeMiner(@Request() req: any, @Param('id') id: string) {
    return this.service.removeMinerFromRack(req.user.id, id);
  }

  /** PATCH /api/mining-room/miner-placements/:id/move — move miner to different slot */
  @Patch('miner-placements/:id/move')
  moveMiner(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: MoveMinerDto,
  ) {
    return this.service.moveMinerInRack(req.user.id, id, dto.targetRackPlacementId, dto.targetSlotIndex);
  }

  // ───── STORAGE ────────────────────────────────────────────────────────────

  /** GET /api/mining-room/storage/racks — racks in inventory */
  @Get('storage/racks')
  getRackStorage(@Request() req: any) {
    return this.service.getRackStorage(req.user.id);
  }

  /** GET /api/mining-room/storage/miners — miners in inventory */
  @Get('storage/miners')
  getMinerStorage(@Request() req: any) {
    return this.service.getMinerStorage(req.user.id);
  }

  // ───── LEGACY (backward compat) ───────────────────────────────────────────

  /** GET /api/mining-room — legacy single room endpoint (returns room 1) */
  @Get()
  legacyGetRoom(@Request() req: any) {
    return this.service.getRoom(req.user.id, 1);
  }

  /** GET /api/mining-room/unplaced — legacy unplaced miners */
  @Get('unplaced')
  legacyGetUnplaced(@Request() req: any) {
    return this.service.getMinerStorage(req.user.id);
  }
}
