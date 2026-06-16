import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageEvent } from '@nestjs/common';
import { Subject, Observable, finalize } from 'rxjs';

export interface NotificationPayload {
  type: string;
  data: unknown;
  timestamp: string;
}

@Injectable()
export class NotificationService {
  // userId → active SSE connections for that user
  private readonly sseClients = new Map<string, Set<Subject<MessageEvent>>>();

  subscribeSSE(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    if (!this.sseClients.has(userId)) {
      this.sseClients.set(userId, new Set());
    }
    this.sseClients.get(userId)!.add(subject);

    // finalize() fires when the Observable is unsubscribed — i.e., the client closes the SSE connection
    return subject.asObservable().pipe(
      finalize(() => {
        const clients = this.sseClients.get(userId);
        if (clients) {
          clients.delete(subject);
          if (clients.size === 0) this.sseClients.delete(userId);
        }
      }),
    );
  }

  sendToUser(userId: string, type: string, data: unknown): void {
    const clients = this.sseClients.get(userId);
    if (!clients?.size) return;

    const payload: NotificationPayload = { type, data, timestamp: new Date().toISOString() };
    const event: MessageEvent = { data: payload, type };
    clients.forEach((s) => s.next(event));
  }

  broadcast(type: string, data: unknown): void {
    const payload: NotificationPayload = { type, data, timestamp: new Date().toISOString() };
    const event: MessageEvent = { data: payload, type };
    this.sseClients.forEach((clients) => clients.forEach((s) => s.next(event)));
  }

  // ── Domain event listeners ──────────────────────────────────────────────────
  // SSE clients are notified when domain mutations happen so they stay in sync
  // without polling. The WebSocket gateway listens to the same events separately.

  @OnEvent('user.updated')
  onUserUpdated(payload: { userId: string }): void {
    this.sendToUser(payload.userId, 'user:updated', payload);
  }

  @OnEvent('user.deactivated')
  onUserDeactivated(payload: { userId: string }): void {
    this.sendToUser(payload.userId, 'user:deactivated', payload);
  }
}
