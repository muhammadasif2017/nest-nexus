import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { Permission } from '../enums/permission.enum';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { getRequestFromContext } from '../utils/execution-context.util';

// Scopes layer. Runs AFTER the global JwtAuthGuard (depends on req.user).
// Requires ALL permissions listed in @RequirePermission. Pure RBAC→scope check —
// no resource needed, so it works on collection routes (create/list) too.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = getRequestFromContext(context).user;
    const ok = required.every((p) => this.authz.hasPermission(user, p));
    if (!ok) throw new ForbiddenException('Insufficient permissions.');
    return true;
  }
}
