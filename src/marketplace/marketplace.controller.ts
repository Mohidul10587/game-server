import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsString, IsInt, IsPositive } from 'class-validator';
import { MarketplaceService } from './marketplace.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class BuyMinerDto {
  @IsString()
  minerId: string;
}

class ListMinerDto {
  @IsString()
  userMinerId: string;

  @IsInt()
  @IsPositive()
  price: number;
}

@UseGuards(JwtAuthGuard)
@Controller('marketplace')
export class MarketplaceController {
  constructor(private marketplaceService: MarketplaceService) {}

  @Get('miners')
  getMiners() {
    return this.marketplaceService.getMiners();
  }

  @Post('buy')
  buyMiner(
    @Request() req: { user: { id: string } },
    @Body() dto: BuyMinerDto,
  ) {
    return this.marketplaceService.buyMiner(req.user.id, dto.minerId);
  }

  @Post('list')
  listMiner(
    @Request() req: { user: { id: string } },
    @Body() dto: ListMinerDto,
  ) {
    return this.marketplaceService.listMiner(
      req.user.id,
      dto.userMinerId,
      dto.price,
    );
  }

  @Post('purchase/:listingId')
  purchaseListing(
    @Request() req: { user: { id: string } },
    @Param('listingId') listingId: string,
  ) {
    return this.marketplaceService.purchaseListing(req.user.id, listingId);
  }

  @Get('my-miners')
  getMyMiners(@Request() req: { user: { id: string } }) {
    return this.marketplaceService.getMyMiners(req.user.id);
  }

  @Get('listings')
  getListings() {
    return this.marketplaceService.getListings();
  }
}
