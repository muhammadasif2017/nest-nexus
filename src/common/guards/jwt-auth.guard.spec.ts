import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const mockReflector = (isPublic: boolean | undefined) =>
  ({
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  }) as unknown as Reflector;

const httpContext = (req: object = {}): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    superCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('canActivate — @Public() bypass', () => {
    it('returns true without calling super when route is public', async () => {
      const guard = new JwtAuthGuard(mockReflector(true));
      const result = await guard.canActivate(httpContext());

      expect(result).toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it('delegates to super when route is not public', async () => {
      const guard = new JwtAuthGuard(mockReflector(false));
      await guard.canActivate(httpContext());

      expect(superCanActivate).toHaveBeenCalled();
    });

    it('delegates to super when @Public() is absent (undefined)', async () => {
      const guard = new JwtAuthGuard(mockReflector(undefined));
      await guard.canActivate(httpContext());

      expect(superCanActivate).toHaveBeenCalled();
    });

    it('returns super result true when JWT is valid', async () => {
      superCanActivate.mockResolvedValue(true);
      const guard = new JwtAuthGuard(mockReflector(false));

      const result = await guard.canActivate(httpContext());

      expect(result).toBe(true);
    });

    it('returns super result false when JWT is invalid', async () => {
      superCanActivate.mockResolvedValue(false);
      const guard = new JwtAuthGuard(mockReflector(false));

      const result = await guard.canActivate(httpContext());

      expect(result).toBe(false);
    });
  });

  describe('canActivate — reflector reads correct keys', () => {
    it('checks IS_PUBLIC_KEY on handler then class', async () => {
      const reflector = mockReflector(true);
      const guard = new JwtAuthGuard(reflector);
      const ctx = httpContext();

      await guard.canActivate(ctx);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    });
  });

  describe('getRequest — context bridge', () => {
    it('returns HTTP request for HTTP context', () => {
      const guard = new JwtAuthGuard(mockReflector(false));
      const req = { headers: { authorization: 'Bearer token' } };
      const ctx = httpContext(req);

      expect(guard.getRequest(ctx)).toBe(req);
    });
  });
});
