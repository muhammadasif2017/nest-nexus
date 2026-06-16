import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_PENDING_2FA_KEY } from '../decorators/allow-pending-2fa.decorator';
import { JwtPayload } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const activated = await super.canActivate(context);
    if (!activated) return false;

    // Tokens with scope='two_factor_pending' are only valid on routes that
    // explicitly opt in via @AllowPending2FA(). All other routes reject them
    // so a half-authenticated session can't access protected resources.
    const request = this.getRequest(context);
    const user = request.user as JwtPayload | undefined;
    if (user?.scope === 'two_factor_pending') {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_2FA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new UnauthorizedException('Two-factor authentication required to complete login.');
      }
    }

    return true;
  }

  getRequest(context: ExecutionContext) {
    if (context.getType<string>() === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext().req;
    }
    return context.switchToHttp().getRequest();
  }
}
