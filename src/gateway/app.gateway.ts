import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: process.env['CLIENT_URL'] ?? 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/',
})
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);

  afterInit(_server: Server) {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Emit balance update to a specific user.
   * Client should join room `user:{userId}` on connect.
   */
  emitBalanceUpdate(userId: string, balance: { BTC: number; coins: number }) {
    this.server.to(`user:${userId}`).emit('balance:update', balance);
  }

  /**
   * Emit new withdrawal notification to the user.
   */
  emitWithdrawalNew(
    userId: string,
    withdrawal: { id: string; currency: string; amount: number; status: string },
  ) {
    this.server.to(`user:${userId}`).emit('withdrawal:new', withdrawal);
    // Also broadcast to admin room
    this.server.to('admin').emit('withdrawal:new', withdrawal);
  }

  /**
   * Broadcast reward distribution event to all connected clients.
   */
  broadcastRewardDistributed(data: { totalDistributed: number; cycleAt: Date }) {
    this.server.emit('reward:distributed', data);
  }
}
