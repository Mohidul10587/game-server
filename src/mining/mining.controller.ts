import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsString, IsNumber, IsPositive, Min } from 'class-validator';
import { MiningService } from './mining.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class WithdrawalDto {
  @IsString()
  currency: string;

  @IsNumber()
  @IsPositive()
  @Min(0.000001)
  amount: number;

  @IsString()
  walletAddress: string;
}

@UseGuards(JwtAuthGuard)
@Controller('mining')
export class MiningController {
  constructor(private miningService: MiningService) {}

  @Get('power')
  getPower(@Request() req: { user: { id: string } }) {
    return this.miningService.getPower(req.user.id);
  }

  @Get('balance')
  getBalance(@Request() req: { user: { id: string } }) {
    return this.miningService.getBalance(req.user.id);
  }

  @Get('history')
  getHistory(@Request() req: { user: { id: string } }) {
    return this.miningService.getHistory(req.user.id);
  }

  @Post('withdraw')
  requestWithdrawal(
    @Request() req: { user: { id: string } },
    @Body() dto: WithdrawalDto,
  ) {
    return this.miningService.requestWithdrawal(
      req.user.id,
      dto.currency,
      dto.amount,
      dto.walletAddress,
    );
  }
}
