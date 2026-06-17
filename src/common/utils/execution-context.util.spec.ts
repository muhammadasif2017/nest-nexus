import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getRequestFromContext } from './execution-context.util';

function makeHttpContext(request: object): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGraphqlContext(request: object): ExecutionContext {
  jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getContext: () => ({ req: request }),
  } as any);
  return { getType: () => 'graphql' } as unknown as ExecutionContext;
}

describe('getRequestFromContext()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the HTTP request when context type is http', () => {
    const request = { user: { id: 'user-1' } };
    expect(getRequestFromContext(makeHttpContext(request))).toBe(request);
  });

  it('returns req.user-bearing object unwrapped from GraphQL context', () => {
    const request = { user: { id: 'user-2' } };
    expect(getRequestFromContext(makeGraphqlContext(request))).toBe(request);
  });

  it('treats any non-graphql context type as HTTP', () => {
    const request = { user: { id: 'user-3' } };
    const context = {
      getType: () => 'rpc',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    expect(getRequestFromContext(context)).toBe(request);
  });
});
