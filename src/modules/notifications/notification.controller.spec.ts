import { Observable } from 'rxjs';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

const makeServiceMock = () => ({
  subscribeSSE: jest.fn(),
});

const makeController = () => {
  const service = makeServiceMock();
  const controller = new NotificationController(service as unknown as NotificationService);
  return { controller, service };
};

const makeUser = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'user-id-1',
  email: 'test@example.com',
  roles: ['user'],
  ...overrides,
});

describe('NotificationController', () => {
  describe('stream()', () => {
    it('delegates to notificationService.subscribeSSE with the current user id', () => {
      const { controller, service } = makeController();
      const observable = new Observable();
      service.subscribeSSE.mockReturnValue(observable);

      const result = controller.stream(makeUser({ sub: 'distinct-user' }));

      expect(service.subscribeSSE).toHaveBeenCalledWith('distinct-user');
      expect(result).toBe(observable);
    });
  });
});
