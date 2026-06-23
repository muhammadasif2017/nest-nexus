import { ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from './execution-context.util';

function makeHttpContext(request: object): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('getRequestFromContext()', () => {
  it('returns the HTTP request from the context', () => {
    const request = { user: { id: 'user-1' } };
    expect(getRequestFromContext(makeHttpContext(request))).toBe(request);
  });
});
