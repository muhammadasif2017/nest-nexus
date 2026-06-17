import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { getRequestFromContext } from '../utils/execution-context.util';

// IMPORTANT: The RolesGuard must run AFTER JwtAuthGuard in the guard chain,
// because it depends on req.user being populated — which JwtAuthGuard does.
// Guard execution order follows the order of @UseGuards() decorators.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator is present, the route has no role requirement.
    // The JwtAuthGuard already ensured the user is *authenticated* — this guard
    // only adds the *authorization* layer on top.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = getRequestFromContext(context).user;

    // user?.roles is the array from the JWT payload (populated by JwtStrategy.validate)
    return requiredRoles.some((role) => user?.roles?.includes(role));
  }
}