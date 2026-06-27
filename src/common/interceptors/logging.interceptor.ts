import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  // We inject the logger so this interceptor participates in NestJS's DI system.
  // This means the logger is properly initialized and carries the right context.
  constructor(
    @InjectPinoLogger(LoggingInterceptor.name)
    private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();

    const req = context.switchToHttp().getRequest();
    const operationLabel = `[HTTP] ${req.method} ${req.url}`;

    this.logger.debug({ operationLabel }, 'Incoming request');

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.info({ operationLabel, duration }, `Request completed in ${duration}ms`);
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const status: number = err?.status ?? err?.statusCode ?? 500;
          // 4xx = client error (warn); 5xx = server error (error).
          // GlobalExceptionFilter owns the response shape — we only log here.
          if (status >= 400 && status < 500) {
            this.logger.warn({ operationLabel, duration, err }, 'Request failed');
          } else {
            this.logger.error({ operationLabel, duration, err }, 'Request failed');
          }
        },
      }),
    );
  }
}
