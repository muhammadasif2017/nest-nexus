import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { HTTP_REQUEST_DURATION, HTTP_REQUESTS_TOTAL } from './metrics.module';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric(HTTP_REQUEST_DURATION) private readonly histogram: Histogram<string>,
    @InjectMetric(HTTP_REQUESTS_TOTAL) private readonly counter: Counter<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only instrument HTTP — WebSocket and GraphQL have different cardinality profiles
    if (context.getType<string>() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method;
    const endTimer = this.histogram.startTimer();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          // Use the matched route pattern (/users/:id) not the actual URL (/users/abc123)
          // to keep cardinality bounded — one label value per route, not per request.
          const route = (req.route?.path as string | undefined) ?? req.path;
          const statusCode = String(res.statusCode);
          endTimer({ method, route, status_code: statusCode });
          this.counter.inc({ method, route, status_code: statusCode });
        },
        error: (err: { status?: number }) => {
          const route = (req.route?.path as string | undefined) ?? req.path;
          const statusCode = String(err?.status ?? 500);
          endTimer({ method, route, status_code: statusCode });
          this.counter.inc({ method, route, status_code: statusCode });
        },
      }),
    );
  }
}
