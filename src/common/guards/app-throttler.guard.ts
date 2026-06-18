import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

// The stock ThrottlerGuard only knows how to pull the request via
// context.switchToHttp(), which is undefined for GraphQL execution contexts —
// every GraphQL query/mutation throws ("Cannot read properties of undefined
// (reading 'ip')") since this guard is registered globally via APP_GUARD.
// Same dual-context pattern as JwtAuthGuard/RolesGuard (see getRequestFromContext).
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext): {
    req: Record<string, any>;
    res: Record<string, any>;
  } {
    if (context.getType<string>() === 'graphql') {
      const gqlContext = GqlExecutionContext.create(context).getContext();
      return { req: gqlContext.req, res: gqlContext.res };
    }
    return super.getRequestResponse(context);
  }
}
