import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // ── Check for @Public() decorator ────────────────────────────────────────
    // Reflector.getAllAndOverride checks the handler first, then the class.
    // This means a @Public() on a single resolver overrides a class-level @Roles().
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  // ── GraphQL Context Bridge ──────────────────────────────────────────────────
  // Passport's AuthGuard calls getRequest() internally to extract the token.
  // By default, it looks at the HTTP request object. But in GraphQL, the request
  // is nested inside the GraphQL execution context. We override this to bridge them.
  getRequest(context: ExecutionContext) {
    if (context.getType<string>() === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      // This is the Express request object, accessible via the GraphQL context
      // because we configured it in GraphQLModule (shown below).
      return ctx.getContext().req;
    }
    return context.switchToHttp().getRequest();
  }
}