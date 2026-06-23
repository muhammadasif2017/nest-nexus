import { ExecutionContext } from '@nestjs/common';

// Resolves the underlying HTTP request object from an ExecutionContext.
export function getRequestFromContext(context: ExecutionContext): any {
  return context.switchToHttp().getRequest();
}
