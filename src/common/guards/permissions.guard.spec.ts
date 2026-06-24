import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from '../enums/permission.enum';
import { AuthorizationService } from '../../modules/authorization/authorization.service';

const mockReflector = (perms: Permission[] | undefined) =>
  ({ getAllAndOverride: jest.fn().mockReturnValue(perms) }) as unknown as Reflector;

const httpContext = (user: unknown): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  const authz = new AuthorizationService({ check: jest.fn() } as never);

  it('allows when no @RequirePermission metadata', () => {
    const guard = new PermissionsGuard(mockReflector(undefined), authz);
    expect(guard.canActivate(httpContext({ roles: ['user'] }))).toBe(true);
  });

  it('allows when user role grants the permission', () => {
    const guard = new PermissionsGuard(mockReflector([Permission.DOCUMENT_WRITE]), authz);
    expect(guard.canActivate(httpContext({ sub: 'u1', roles: ['user'] }))).toBe(true);
  });

  it('throws Forbidden when the permission is missing', () => {
    const guard = new PermissionsGuard(mockReflector([Permission.DOCUMENT_READ_ANY]), authz);
    expect(() => guard.canActivate(httpContext({ sub: 'u1', roles: ['user'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('requires ALL listed permissions (AND)', () => {
    const guard = new PermissionsGuard(
      mockReflector([Permission.DOCUMENT_WRITE, Permission.DOCUMENT_READ_ANY]),
      authz,
    );
    // user has write but not read:any
    expect(() => guard.canActivate(httpContext({ sub: 'u1', roles: ['user'] }))).toThrow(
      ForbiddenException,
    );
  });
});
