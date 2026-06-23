import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';

const mockReflector = (roles: Role[] | undefined) =>
  ({
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  }) as unknown as Reflector;

const httpContext = (user: unknown): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  describe('no @Roles() decorator', () => {
    it('allows HTTP request when no roles required', () => {
      const guard = new RolesGuard(mockReflector(undefined));
      expect(guard.canActivate(httpContext(null))).toBe(true);
    });

    it('allows when roles array is empty', () => {
      const guard = new RolesGuard(mockReflector([]));
      expect(guard.canActivate(httpContext(null))).toBe(true);
    });
  });

  describe('HTTP context', () => {
    it('allows user with matching role', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN]));
      const user = { roles: [Role.ADMIN] };
      expect(guard.canActivate(httpContext(user))).toBe(true);
    });

    it('denies user without required role', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN]));
      const user = { roles: [Role.USER] };
      expect(guard.canActivate(httpContext(user))).toBe(false);
    });

    it('allows when user has one of multiple required roles', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN, Role.SUPER_ADMIN]));
      const user = { roles: [Role.ADMIN] };
      expect(guard.canActivate(httpContext(user))).toBe(true);
    });

    it('denies when user has no roles property', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN]));
      const user = { email: 'user@test.com' };
      expect(guard.canActivate(httpContext(user))).toBe(false);
    });

    it('denies when user is null', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN]));
      expect(guard.canActivate(httpContext(null))).toBe(false);
    });

    it('denies when user is undefined', () => {
      const guard = new RolesGuard(mockReflector([Role.ADMIN]));
      expect(guard.canActivate(httpContext(undefined))).toBe(false);
    });

    it('allows SUPER_ADMIN when only SUPER_ADMIN required', () => {
      const guard = new RolesGuard(mockReflector([Role.SUPER_ADMIN]));
      const user = { roles: [Role.SUPER_ADMIN] };
      expect(guard.canActivate(httpContext(user))).toBe(true);
    });

    it('denies ADMIN when SUPER_ADMIN required', () => {
      const guard = new RolesGuard(mockReflector([Role.SUPER_ADMIN]));
      const user = { roles: [Role.ADMIN] };
      expect(guard.canActivate(httpContext(user))).toBe(false);
    });

    it('allows user with multiple roles when one matches', () => {
      const guard = new RolesGuard(mockReflector([Role.MODERATOR]));
      const user = { roles: [Role.USER, Role.MODERATOR] };
      expect(guard.canActivate(httpContext(user))).toBe(true);
    });
  });

  describe('reflector usage', () => {
    it('checks both handler and class metadata', () => {
      const reflector = mockReflector([Role.ADMIN]);
      const guard = new RolesGuard(reflector);
      const ctx = httpContext({ roles: [Role.ADMIN] });

      guard.canActivate(ctx);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    });
  });
});
