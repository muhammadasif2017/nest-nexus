import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PolicyGuard } from './policy.guard';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const mockReflector = (name: string | undefined) =>
  ({ getAllAndOverride: jest.fn().mockReturnValue(name) }) as unknown as Reflector;

const httpContext = (user: unknown, id?: string): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id } }) }),
  }) as unknown as ExecutionContext;

describe('PolicyGuard', () => {
  const authz = new AuthorizationService({ check: jest.fn() } as never);
  let prisma: { document: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { document: { findUnique: jest.fn() } };
  });

  const build = (name: string | undefined) =>
    new PolicyGuard(mockReflector(name), authz, prisma as unknown as PrismaService);

  it('allows when no @Policy metadata', async () => {
    expect(await build(undefined).canActivate(httpContext({ roles: [] }))).toBe(true);
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('bypasses for super_admin without loading the resource', async () => {
    expect(
      await build('document.read').canActivate(httpContext({ roles: ['super_admin'] }, 'd1')),
    ).toBe(true);
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('throws Forbidden when :id param is missing', async () => {
    await expect(
      build('document.read').canActivate(httpContext({ sub: 'u1', roles: ['user'] })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFound when the document does not exist', async () => {
    prisma.document.findUnique.mockResolvedValue(null);
    await expect(
      build('document.read').canActivate(httpContext({ sub: 'u1', roles: ['user'] }, 'd1')),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows when the policy passes (public doc)', async () => {
    prisma.document.findUnique.mockResolvedValue({ ownerId: 'owner', visibility: 'public' });
    expect(
      await build('document.read').canActivate(httpContext({ sub: 'u2', roles: ['user'] }, 'd1')),
    ).toBe(true);
  });

  it('throws NotFound when the policy denies (private, non-owner) — no enumeration', async () => {
    prisma.document.findUnique.mockResolvedValue({ ownerId: 'owner', visibility: 'private' });
    await expect(
      build('document.read').canActivate(httpContext({ sub: 'u2', roles: ['user'] }, 'd1')),
    ).rejects.toThrow(NotFoundException);
  });
});
