import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

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

    let user: any;

    if (context.getType<string>() === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      user = ctx.getContext().req.user;
    } else {
      user = context.switchToHttp().getRequest().user;
    }

    // user?.roles is the array from the JWT payload (populated by JwtStrategy.validate)
    return requiredRoles.some((role) => user?.roles?.includes(role));
  }
}