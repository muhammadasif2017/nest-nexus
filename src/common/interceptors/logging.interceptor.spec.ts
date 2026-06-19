import { ExecutionContext, CallHandler } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { of, throwError } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { LoggingInterceptor } from './logging.interceptor';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: jest.fn() },
}));

const makeLoggerMock = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
});

const makeHandler = (observable: ReturnType<typeof of>): CallHandler => ({
  handle: () => observable,
});

const httpContext = (req: object = { method: 'GET', url: '/users' }): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const gqlContext = (info: object = { parentType: { name: 'Query' }, fieldName: 'users' }) => {
  (GqlExecutionContext.create as jest.Mock).mockReturnValue({ getInfo: () => info });
  return { getType: () => 'graphql' } as unknown as ExecutionContext;
};

describe('LoggingInterceptor', () => {
  let logger: ReturnType<typeof makeLoggerMock>;
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    logger = makeLoggerMock();
    interceptor = new LoggingInterceptor(logger as unknown as PinoLogger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('intercept() — HTTP', () => {
    it('logs the HTTP method and url on incoming request', (done) => {
      interceptor
        .intercept(httpContext({ method: 'POST', url: '/login' }), makeHandler(of('ok')))
        .subscribe(() => {
          expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({ operationLabel: '[HTTP] POST /login' }),
            'Incoming request',
          );
          done();
        });
    });

    it('logs completion with duration on success', (done) => {
      interceptor.intercept(httpContext(), makeHandler(of('ok'))).subscribe(() => {
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            operationLabel: '[HTTP] GET /users',
            duration: expect.any(Number),
          }),
          expect.stringContaining('Request completed'),
        );
        done();
      });
    });

    it('logs an error with duration on failure', (done) => {
      const error = new Error('boom');
      interceptor.intercept(httpContext(), makeHandler(throwError(() => error))).subscribe({
        error: () => {
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ operationLabel: '[HTTP] GET /users', err: error }),
            'Request failed',
          );
          done();
        },
      });
    });
  });

  describe('intercept() — GraphQL', () => {
    it('logs the operation label using parentType and fieldName', (done) => {
      interceptor
        .intercept(
          gqlContext({ parentType: { name: 'Mutation' }, fieldName: 'login' }),
          makeHandler(of('ok')),
        )
        .subscribe(() => {
          expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({ operationLabel: '[GraphQL] Mutation.login' }),
            'Incoming request',
          );
          done();
        });
    });

    it('does not call switchToHttp for GraphQL context', (done) => {
      const ctx = gqlContext();
      const switchToHttp = jest.fn();
      (ctx as any).switchToHttp = switchToHttp;
      interceptor.intercept(ctx, makeHandler(of('ok'))).subscribe(() => {
        expect(switchToHttp).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('propagates the emitted value unchanged', (done) => {
    interceptor.intercept(httpContext(), makeHandler(of({ id: 1 }))).subscribe((value) => {
      expect(value).toEqual({ id: 1 });
      done();
    });
  });

  it('propagates the error unchanged', (done) => {
    const error = new Error('boom');
    interceptor.intercept(httpContext(), makeHandler(throwError(() => error))).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        done();
      },
    });
  });
});
