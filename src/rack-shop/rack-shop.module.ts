import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RackShopService } from './rack-shop.service.js';
import { RackShopController } from './rack-shop.controller.js';

@Module({
  imports: [AuthModule],
  providers: [RackShopService],
  controllers: [RackShopController],
  exports: [RackShopService],
})
export class RackShopModule {}
