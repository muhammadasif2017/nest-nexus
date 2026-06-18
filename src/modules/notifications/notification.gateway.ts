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
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// Extend Socket to carry the authenticated user after connection validation
interface AuthenticatedSocket extends Socket {
  data: { userId: string; email: string };
}

@WebSocketGateway({
  cors: {
    // ConfigService is unavailable at decorator evaluation time (runs before DI).
    // Origin is validated per-request against CLIENT_ORIGIN env var.
    origin: (reqOrigin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      const allowed = process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';
      cb(null, !reqOrigin || reqOrigin === allowed);
    },
    credentials: true,
  },
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

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
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
    this.server.to(`user:${userId}`).emit(event, this.buildPayload(event, data));
  }

  broadcast(event: string, data: unknown): void {
    this.server.emit(event, this.buildPayload(event, data));
  }

  private buildPayload(type: string, data: unknown) {
    return { type, data, timestamp: new Date().toISOString() };
  }

  // ── Inbound message handlers ────────────────────────────────────────────────

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: AuthenticatedSocket): void {
    client.emit('pong', { timestamp: new Date().toISOString() });
  }

  // Clients may only join their own user room — prevents one user subscribing to another's events.
  @SubscribeMessage('join:room')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { room: string },
  ): Promise<void> {
    const ownRoom = `user:${client.data.userId}`;
    if (data?.room && data.room === ownRoom) {
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
    this.server.to('admin').emit('user:created', this.buildPayload('user:created', payload));
  }
}
