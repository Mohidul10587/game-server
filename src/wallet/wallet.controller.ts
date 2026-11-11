import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsString, IsNumber, IsPositive } from 'class-validator';
import { WalletService } from './wallet.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class GenerateAddressDto {
  @IsString()
  currency: string;
}

class ConfirmDepositDto {
  @IsString()
  currency: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  txHash: string;
}

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  /**
   * GET /api/wallet/deposit-addresses
   * Returns all existing deposit addresses for the user.
   */
  @Get('deposit-addresses')
  getAddresses(@Request() req: any) {
    return this.walletService.getDepositAddresses(req.user.id);
  }

  /**
   * POST /api/wallet/deposit-address
   * Get or generate a deposit address for a specific currency.
   * Body: { currency: 'BTC' | 'ETH' | 'SOL' }
   */
  @Post('deposit-address')
  getOrCreateAddress(@Request() req: any, @Body() dto: GenerateAddressDto) {
    return this.walletService.getOrCreateDepositAddress(req.user.id, dto.currency);
  }

  /**
   * GET /api/wallet/deposit-history
   * User's deposit transaction history.
   */
  @Get('deposit-history')
  getDepositHistory(@Request() req: any) {
    return this.walletService.getDepositHistory(req.user.id);
  }

  /**
   * POST /api/wallet/confirm-deposit
   * Webhook-style deposit confirmation (for testing/simulation).
   * In production, this would be called by a blockchain indexer.
   */
  @Post('confirm-deposit')
  confirmDeposit(@Request() req: any, @Body() dto: ConfirmDepositDto) {
    return this.walletService.confirmDeposit(
      req.user.id,
      dto.currency,
      dto.amount,
      dto.txHash,
    );
  }
}
