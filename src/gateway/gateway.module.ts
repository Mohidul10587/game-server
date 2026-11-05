import { Module } from '@nestjs/common';
import { AppGateway } from './app.gateway.js';

@Module({
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
