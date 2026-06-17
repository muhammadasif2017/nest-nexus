import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

// Resolves the underlying request object from either an HTTP or GraphQL ExecutionContext.
export function getRequestFromContext(context: ExecutionContext): any {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext().req;
  }
  return context.switchToHttp().getRequest();
}
