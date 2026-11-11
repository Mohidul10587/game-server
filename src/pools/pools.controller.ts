import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  IsArray,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PoolsService } from './pools.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class AllocationItemDto {
  @IsString()
  poolId: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  powerPercent: number;
}

class SetAllocationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations: AllocationItemDto[];
}

@UseGuards(JwtAuthGuard)
@Controller('pools')
export class PoolsController {
  constructor(private poolsService: PoolsService) {}

  /** GET /api/pools — list all active pools */
  @Get()
  getPools() {
    return this.poolsService.getPools();
  }

  /** GET /api/pools/my-allocations — user's current split */
  @Get('my-allocations')
  getMyAllocations(@Request() req: any) {
    return this.poolsService.getUserAllocations(req.user.id);
  }

  /** POST /api/pools/allocate — set power split percentages */
  @Post('allocate')
  setAllocations(@Request() req: any, @Body() dto: SetAllocationsDto) {
    return this.poolsService.setAllocations(req.user.id, dto.allocations);
  }

  /** POST /api/pools/even-split — evenly distribute power across all pools */
  @Post('even-split')
  evenSplit(@Request() req: any) {
    return this.poolsService.evenSplit(req.user.id);
  }

  /** GET /api/pools/:id/stats — pool stats + user's current allocation */
  @Get(':id/stats')
  getPoolStats(@Param('id') id: string, @Request() req: any) {
    return this.poolsService.getPoolStats(id, req.user.id);
  }
}
