import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  IsInt, IsOptional, IsPositive, IsBoolean,
  IsNumber, IsString, IsIn, Min,
} from 'class-validator';
import { AdminService } from './admin.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from './admin.guard.js';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class UpdateRewardConfigDto {
  @IsOptional() @IsInt() @IsPositive() poolAmountPerCycle?: number;
  @IsOptional() @IsInt() @IsPositive() cycleMinutes?: number;
}

class BanUserDto {
  @IsBoolean() isBanned: boolean;
}

class UpdatePoolConfigDto {
  @IsOptional() @IsNumber() @Min(0) poolAmountPerCycle?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CreateMinerDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']) rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  @IsInt() @Min(1) basePower: number;
  @IsInt() @Min(1) price: number;
  @IsString() imageUrl: string;
  @IsOptional() @IsString() minerType?: string;
}

class UpdateMinerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) basePower?: number;
  @IsOptional() @IsInt() @Min(1) price?: number;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() minerType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CreateRackDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsInt() @Min(1) price: number;
  @IsInt() @Min(1) @IsPositive() minerCapacity: number;
  @IsOptional() @IsString() rackType?: string;
}

class UpdateRackDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(1) price?: number;
  @IsOptional() @IsInt() @Min(1) minerCapacity?: number;
  @IsOptional() @IsString() rackType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateRoomConfigDto {
  @IsOptional() @IsInt() @Min(0) unlockCost?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ───── DASHBOARD ─────────────────────────────────────────────────────────
  @Get('dashboard')
  getDashboard() { return this.adminService.getDashboardStats(); }

  // ───── WITHDRAWALS ────────────────────────────────────────────────────────
  @Get('withdrawals')
  getPendingWithdrawals() { return this.adminService.getPendingWithdrawals(); }

  @Patch('withdrawals/:id/approve')
  approveWithdrawal(@Param('id') id: string) { return this.adminService.approveWithdrawal(id); }

  @Patch('withdrawals/:id/reject')
  rejectWithdrawal(@Param('id') id: string) { return this.adminService.rejectWithdrawal(id); }

  // ───── REWARD CONFIG ──────────────────────────────────────────────────────
  @Get('reward-config')
  getRewardConfig() { return this.adminService.getRewardConfig(); }

  @Patch('reward-config')
  updateRewardConfig(@Body() dto: UpdateRewardConfigDto) {
    return this.adminService.updateRewardConfig(dto.poolAmountPerCycle, dto.cycleMinutes);
  }

  @Get('pools')
  getPoolStats() { return this.adminService.getPoolStats(); }

  @Patch('pools/:id')
  updatePoolConfig(@Param('id') id: string, @Body() dto: UpdatePoolConfigDto) {
    return this.adminService.updatePoolConfig(id, dto.poolAmountPerCycle, dto.isActive);
  }

  // ───── USERS ──────────────────────────────────────────────────────────────
  @Get('users')
  getUsers() { return this.adminService.getUsers(); }

  @Patch('users/:id/ban')
  banUser(@Param('id') id: string, @Body() dto: BanUserDto) {
    return this.adminService.banUser(id, dto.isBanned);
  }

  // ───── MINER PRODUCTS ─────────────────────────────────────────────────────
  @Get('miner-products')
  getMinerProducts() { return this.adminService.getMinerProducts(); }

  @Post('miner-products')
  createMinerProduct(@Body() dto: CreateMinerDto) {
    return this.adminService.createMinerProduct(dto);
  }

  @Patch('miner-products/:id')
  updateMinerProduct(@Param('id') id: string, @Body() dto: UpdateMinerDto) {
    return this.adminService.updateMinerProduct(id, dto);
  }

  @Delete('miner-products/:id')
  deactivateMinerProduct(@Param('id') id: string) {
    return this.adminService.deactivateMinerProduct(id);
  }

  // ───── RACK PRODUCTS ──────────────────────────────────────────────────────
  @Get('rack-products')
  getRackProducts() { return this.adminService.getRackProducts(); }

  @Post('rack-products')
  createRackProduct(@Body() dto: CreateRackDto) {
    return this.adminService.createRackProduct(dto);
  }

  @Patch('rack-products/:id')
  updateRackProduct(@Param('id') id: string, @Body() dto: UpdateRackDto) {
    return this.adminService.updateRackProduct(id, dto);
  }

  @Delete('rack-products/:id')
  deactivateRackProduct(@Param('id') id: string) {
    return this.adminService.deactivateRackProduct(id);
  }

  // ───── ROOM CONFIG ────────────────────────────────────────────────────────
  @Get('room-config')
  getRoomConfigs() { return this.adminService.getRoomConfigs(); }

  @Patch('room-config/:roomNumber')
  updateRoomConfig(
    @Param('roomNumber', ParseIntPipe) roomNumber: number,
    @Body() dto: UpdateRoomConfigDto,
  ) {
    return this.adminService.updateRoomConfig(roomNumber, dto);
  }
}
