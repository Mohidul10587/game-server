import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsPositive, IsBoolean } from 'class-validator';
import { AdminService } from './admin.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from './admin.guard.js';

class UpdateRewardConfigDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  poolAmountPerCycle?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  cycleMinutes?: number;
}

class BanUserDto {
  @IsBoolean()
  isBanned: boolean;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('withdrawals')
  getPendingWithdrawals() {
    return this.adminService.getPendingWithdrawals();
  }

  @Patch('withdrawals/:id/approve')
  approveWithdrawal(@Param('id') id: string) {
    return this.adminService.approveWithdrawal(id);
  }

  @Patch('withdrawals/:id/reject')
  rejectWithdrawal(@Param('id') id: string) {
    return this.adminService.rejectWithdrawal(id);
  }

  @Get('reward-config')
  getRewardConfig() {
    return this.adminService.getRewardConfig();
  }

  @Patch('reward-config')
  updateRewardConfig(@Body() dto: UpdateRewardConfigDto) {
    return this.adminService.updateRewardConfig(
      dto.poolAmountPerCycle,
      dto.cycleMinutes,
    );
  }

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:id/ban')
  banUser(@Param('id') id: string, @Body() dto: BanUserDto) {
    return this.adminService.banUser(id, dto.isBanned);
  }
}
