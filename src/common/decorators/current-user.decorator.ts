import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from '../utils/execution-context.util';

// A param decorator that extracts the current user from the request,
// handling both HTTP (req.user) and GraphQL (context.req.user) contexts.
// Usage in a resolver: getUserProfile(@CurrentUser() user: JwtPayload)
export const CurrentUser = createParamDecorator(
  (data: string | undefined, context: ExecutionContext) => {
    // Guards have already run by the time this decorator fires, so
    // req.user is guaranteed to be populated if the route is protected.
    const user = getRequestFromContext(context).user;

    // If called as @CurrentUser('email'), return just that field.
    // If called as @CurrentUser(), return the whole user object.
    return data ? user?.[data] : user;
  },
);