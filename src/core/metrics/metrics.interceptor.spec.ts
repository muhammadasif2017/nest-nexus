import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

const makeHistogramMock = () => {
  const endTimer = jest.fn();
  return { startTimer: jest.fn().mockReturnValue(endTimer), _endTimer: endTimer };
};

const makeCounterMock = () => ({ inc: jest.fn() });

const makeInterceptor = () => {
  const histogram = makeHistogramMock();
  const counter = makeCounterMock();
  const interceptor = new MetricsInterceptor(
    histogram as unknown as Histogram<string>,
    counter as unknown as Counter<string>,
  );
  return { interceptor, histogram, counter };
};

const makeHandler = (observable: ReturnType<typeof of>): CallHandler => ({
  handle: () => observable,
});

const httpContext = (
  req: object = { method: 'GET', path: '/users/abc123', route: { path: '/users/:id' } },
  res: object = { statusCode: 200 },
): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  }) as unknown as ExecutionContext;

const nonHttpContext = (): ExecutionContext =>
  ({
    getType: () => 'graphql',
  }) as unknown as ExecutionContext;

describe('MetricsInterceptor', () => {
  describe('intercept() — non-HTTP', () => {
    it('passes through without recording metrics for non-HTTP contexts', (done) => {
      const { interceptor, histogram, counter } = makeInterceptor();
      interceptor.intercept(nonHttpContext(), makeHandler(of('ok'))).subscribe((value) => {
        expect(value).toBe('ok');
        expect(histogram.startTimer).not.toHaveBeenCalled();
        expect(counter.inc).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('intercept() — HTTP success', () => {
    it('records duration and increments the counter using the matched route pattern', (done) => {
      const { interceptor, histogram, counter } = makeInterceptor();
      interceptor.intercept(httpContext(), makeHandler(of('ok'))).subscribe(() => {
        expect(histogram._endTimer).toHaveBeenCalledWith({
          method: 'GET',
          route: '/users/:id',
          status_code: '200',
        });
        expect(counter.inc).toHaveBeenCalledWith({
          method: 'GET',
          route: '/users/:id',
          status_code: '200',
        });
        done();
      });
    });

    it('falls back to req.path when no matched route exists', (done) => {
      const { interceptor, counter } = makeInterceptor();
      const req = { method: 'GET', path: '/unmatched', route: undefined };
      interceptor.intercept(httpContext(req), makeHandler(of('ok'))).subscribe(() => {
        expect(counter.inc).toHaveBeenCalledWith(expect.objectContaining({ route: '/unmatched' }));
        done();
      });
    });

    it('reads the status code from the response after completion', (done) => {
      const { interceptor, counter } = makeInterceptor();
      const res = { statusCode: 201 };
      interceptor.intercept(httpContext(undefined, res), makeHandler(of('ok'))).subscribe(() => {
        expect(counter.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '201' }));
        done();
      });
    });
  });

  describe('intercept() — HTTP error', () => {
    it('records the error status code from the thrown error', (done) => {
      const { interceptor, counter } = makeInterceptor();
      const error = { status: 404 };
      interceptor.intercept(httpContext(), makeHandler(throwError(() => error))).subscribe({
        error: () => {
          expect(counter.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '404' }));
          done();
        },
      });
    });

    it('defaults to status 500 when the error has no status', (done) => {
      const { interceptor, counter } = makeInterceptor();
      const error = new Error('boom');
      interceptor.intercept(httpContext(), makeHandler(throwError(() => error))).subscribe({
        error: () => {
          expect(counter.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '500' }));
          done();
        },
      });
    });

    it('propagates the original error', (done) => {
      const { interceptor } = makeInterceptor();
      const error = new Error('boom');
      interceptor.intercept(httpContext(), makeHandler(throwError(() => error))).subscribe({
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
