import 'reflect-metadata';
import { NotificationService } from './notification.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const collectEvents = (service: NotificationService, userId: string) => {
  const received: unknown[] = [];
  const subscription = service.subscribeSSE(userId).subscribe((event) => received.push(event));
  return { received, subscription };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
  });

  // ── subscribeSSE ─────────────────────────────────────────────────────────────

  describe('subscribeSSE()', () => {
    it('adds the client to the user map so it receives sent events', () => {
      const { received } = collectEvents(service, 'user-1');
      service.sendToUser('user-1', 'ping', { ok: true });
      expect(received).toHaveLength(1);
    });

    it('supports multiple clients per user — both receive the same event', () => {
      const client1 = collectEvents(service, 'user-1');
      const client2 = collectEvents(service, 'user-1');
      service.sendToUser('user-1', 'ping', { ok: true });
      expect(client1.received).toHaveLength(1);
      expect(client2.received).toHaveLength(1);
    });

    it('removes the client on unsubscribe (cleanup)', () => {
      const { received, subscription } = collectEvents(service, 'user-1');
      subscription.unsubscribe();
      service.sendToUser('user-1', 'ping', { ok: true });
      expect(received).toHaveLength(0);
    });

    it('deletes the user map entry once the last client unsubscribes', () => {
      const { subscription } = collectEvents(service, 'user-1');
      subscription.unsubscribe();
      expect((service as any).sseClients.has('user-1')).toBe(false);
    });

    it('keeps the user map entry when one of multiple clients unsubscribes', () => {
      const client1 = collectEvents(service, 'user-1');
      collectEvents(service, 'user-1');
      client1.subscription.unsubscribe();
      expect((service as any).sseClients.has('user-1')).toBe(true);
    });
  });

  // ── sendToUser ───────────────────────────────────────────────────────────────

  describe('sendToUser()', () => {
    it('delivers the event to all clients subscribed for that user', () => {
      const client1 = collectEvents(service, 'user-1');
      const client2 = collectEvents(service, 'user-1');
      service.sendToUser('user-1', 'notify', { msg: 'hi' });
      expect(client1.received).toEqual(client2.received);
      expect(client1.received[0]).toMatchObject({ type: 'notify', data: expect.objectContaining({ type: 'notify' }) });
    });

    it('does not deliver to clients subscribed for a different user', () => {
      const other = collectEvents(service, 'user-2');
      service.sendToUser('user-1', 'notify', { msg: 'hi' });
      expect(other.received).toHaveLength(0);
    });

    it('is a no-op when the user has no connected clients', () => {
      expect(() => service.sendToUser('ghost-user', 'notify', {})).not.toThrow();
    });
  });

  // ── broadcast ────────────────────────────────────────────────────────────────

  describe('broadcast()', () => {
    it('delivers the event to all connected users', () => {
      const user1 = collectEvents(service, 'user-1');
      const user2 = collectEvents(service, 'user-2');
      service.broadcast('announcement', { msg: 'hello everyone' });
      expect(user1.received).toHaveLength(1);
      expect(user2.received).toHaveLength(1);
    });

    it('is a no-op when there are no connected clients', () => {
      expect(() => service.broadcast('announcement', {})).not.toThrow();
    });
  });

  // ── domain event listeners ───────────────────────────────────────────────────

  describe('onUserUpdated()', () => {
    it('sends a "user:updated" event to the affected user', () => {
      const spy = jest.spyOn(service, 'sendToUser');
      service.onUserUpdated({ userId: 'user-1' });
      expect(spy).toHaveBeenCalledWith('user-1', 'user:updated', { userId: 'user-1' });
    });
  });

  describe('onUserDeactivated()', () => {
    it('sends a "user:deactivated" event to the affected user', () => {
      const spy = jest.spyOn(service, 'sendToUser');
      service.onUserDeactivated({ userId: 'user-1' });
      expect(spy).toHaveBeenCalledWith('user-1', 'user:deactivated', { userId: 'user-1' });
    });
  });
});
