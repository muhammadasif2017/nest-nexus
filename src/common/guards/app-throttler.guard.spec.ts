import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AppThrottlerGuard } from './app-throttler.guard';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: jest.fn() },
}));

const httpContext = (req: object = {}, res: object = {}): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  }) as unknown as ExecutionContext;

const gqlContext = (req: object = {}, res: object = {}): ExecutionContext => {
  (GqlExecutionContext.create as jest.Mock).mockReturnValue({
    getContext: () => ({ req, res }),
  });
  return { getType: () => 'graphql' } as unknown as ExecutionContext;
};

describe('AppThrottlerGuard', () => {
  let superGetRequestResponse: jest.SpyInstance;

  beforeEach(() => {
    superGetRequestResponse = jest
      .spyOn(Object.getPrototypeOf(AppThrottlerGuard.prototype), 'getRequestResponse')
      .mockReturnValue({ req: { fromSuper: true }, res: {} });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getRequestResponse()', () => {
    it('delegates to the parent ThrottlerGuard for HTTP context', () => {
      const guard = new AppThrottlerGuard({} as any, {} as any, {} as any);
      const ctx = httpContext();
      const result = (guard as any).getRequestResponse(ctx);
      expect(superGetRequestResponse).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({ req: { fromSuper: true }, res: {} });
    });

    it('pulls req/res from the GraphQL context without calling the parent', () => {
      const guard = new AppThrottlerGuard({} as any, {} as any, {} as any);
      const req = { ip: '127.0.0.1' };
      const res = { status: 200 };
      const ctx = gqlContext(req, res);
      const result = (guard as any).getRequestResponse(ctx);
      expect(superGetRequestResponse).not.toHaveBeenCalled();
      expect(result).toEqual({ req, res });
    });

    it('calls GqlExecutionContext.create with the context for GraphQL', () => {
      const guard = new AppThrottlerGuard({} as any, {} as any, {} as any);
      const ctx = gqlContext();
      (guard as any).getRequestResponse(ctx);
      expect(GqlExecutionContext.create).toHaveBeenCalledWith(ctx);
    });
  });
});
