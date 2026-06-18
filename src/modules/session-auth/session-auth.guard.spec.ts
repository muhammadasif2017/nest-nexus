import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session-auth.guard';

const httpContext = (session: object = {}): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  }) as unknown as ExecutionContext;

const makePrisma = () => ({
  user: { findUnique: jest.fn() },
});

describe('SessionGuard', () => {
  it('throws when there is no userId in the session', async () => {
    const prisma = makePrisma();
    const guard = new SessionGuard(prisma as any);

    await expect(guard.canActivate(httpContext({}))).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the session user no longer exists', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const guard = new SessionGuard(prisma as any);

    await expect(guard.canActivate(httpContext({ userId: 'u1' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when the session user is deactivated', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      roles: ['user'],
      isActive: false,
    });
    const guard = new SessionGuard(prisma as any);

    await expect(guard.canActivate(httpContext({ userId: 'u1' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows the request and attaches req.user when the session user is active', async () => {
    const prisma = makePrisma();
    const user = { id: 'u1', email: 'a@b.com', roles: ['user'], isActive: true };
    prisma.user.findUnique.mockResolvedValue(user);
    const guard = new SessionGuard(prisma as any);
    const request: any = { session: { userId: 'u1' } };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.user).toMatchObject(user);
  });

  it('serves from cache on the second call without hitting the database', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      roles: ['user'],
      isActive: true,
    });
    const guard = new SessionGuard(prisma as any);
    const ctx = httpContext({ userId: 'u1' });

    await guard.canActivate(ctx);
    await guard.canActivate(ctx);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('evicts the cache entry on user.deactivated and re-queries on next call', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      roles: ['user'],
      isActive: true,
    });
    const guard = new SessionGuard(prisma as any);
    const ctx = httpContext({ userId: 'u1' });

    await guard.canActivate(ctx);
    guard.onUserChanged({ userId: 'u1' });
    await guard.canActivate(ctx);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
