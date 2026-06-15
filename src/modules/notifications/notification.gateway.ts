import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// Extend Socket to carry the authenticated user after connection validation
interface AuthenticatedSocket extends Socket {
  data: { userId: string; email: string };
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/ws',
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    const opts = {
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
      password: this.config.get<string | undefined>('redis.password'),
    };
    const pubClient = new Redis(opts);
    const subClient = pubClient.duplicate();
    // Redis adapter enables cross-instance Socket.IO fan-out
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('WebSocket gateway initialized with Redis adapter');
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    // Token can come from `auth.token` (recommended) or Authorization header
    const token =
      (client.handshake.auth as Record<string, string>)?.token ??
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      client.emit('error', { message: 'Unauthorized: no token' });
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });

      // Reject pending-2FA tokens — they must not be used for WS connections
      if (payload.scope === 'two_factor_pending') {
        throw new Error('Token scope not permitted');
      }

      client.data.userId = payload.sub;
      client.data.email = payload.email;
      // Each user joins their own private room for targeted notifications
      await client.join(`user:${payload.sub}`);
      this.logger.log(`Client connected: userId=${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized: invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.data?.userId) {
      this.logger.log(`Client disconnected: userId=${client.data.userId}`);
    }
  }

  // ── Outbound helpers (called by other services or event listeners) ──────────

  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, {
      type: event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcast(event: string, data: unknown): void {
    this.server.emit(event, { type: event, data, timestamp: new Date().toISOString() });
  }

  // ── Inbound message handlers ────────────────────────────────────────────────

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: AuthenticatedSocket): void {
    client.emit('pong', { timestamp: new Date().toISOString() });
  }

  // Allows a client to join a shared room (e.g., a team or channel room)
  @SubscribeMessage('join:room')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { room: string },
  ): Promise<void> {
    if (data?.room) {
      await client.join(data.room);
      client.emit('room:joined', { room: data.room });
    }
  }

  // ── Domain event listeners ─────────────────────────────────────────────────
  // Forward domain mutations to connected WebSocket clients in real time.
  // The SSE controller handles the same events independently via NotificationService.

  @OnEvent('user.updated')
  onUserUpdated(payload: { userId: string }): void {
    this.sendToUser(payload.userId, 'user:updated', payload);
  }

  @OnEvent('user.deactivated')
  onUserDeactivated(payload: { userId: string }): void {
    this.sendToUser(payload.userId, 'user:deactivated', payload);
    // Force-disconnect sessions for deactivated users
    this.server.in(`user:${payload.userId}`).disconnectSockets(true);
  }

  @OnEvent('user.created')
  onUserCreated(payload: { userId: string }): void {
    // Admins or dashboard clients can subscribe to a global channel
    this.server.to('admin').emit('user:created', {
      type: 'user:created',
      data: payload,
      timestamp: new Date().toISOString(),
    });
  }
}
