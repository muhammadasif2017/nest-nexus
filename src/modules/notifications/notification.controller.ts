import { Controller, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // Server-Sent Events stream — alternative to WebSocket for clients that prefer it.
  // Client connects with EventSource and an Authorization: Bearer <token> header.
  // The connection stays open; the server pushes events as they occur.
  // On client close the Observable is unsubscribed and the Subject is cleaned up.
  @Sse('stream')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Subscribe to real-time notifications (SSE)',
    description: 'Long-lived connection. Events are pushed as they occur. Reconnect with `Last-Event-ID` header to resume.',
  })
  stream(@CurrentUser() user: JwtPayload): Observable<MessageEvent> {
    return this.notificationService.subscribeSSE(user.sub);
  }
}
