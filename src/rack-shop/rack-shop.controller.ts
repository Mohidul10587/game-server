import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { RackShopService } from './rack-shop.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

class BuyRackDto {
  @IsString()
  rackProductId: string;
}

@UseGuards(JwtAuthGuard)
@Controller('rack-shop')
export class RackShopController {
  constructor(private readonly service: RackShopService) {}

  /** GET /api/rack-shop/racks — list all rack products */
  @Get('racks')
  getRacks() {
    return this.service.getRackProducts();
  }

  /** GET /api/rack-shop/racks/:id — single rack product */
  @Get('racks/:id')
  getRack(@Param('id') id: string) {
    return this.service.getRackProduct(id);
  }

  /** POST /api/rack-shop/buy — buy a rack */
  @Post('buy')
  buyRack(@Request() req: any, @Body() dto: BuyRackDto) {
    return this.service.buyRack(req.user.id, dto.rackProductId);
  }
}
