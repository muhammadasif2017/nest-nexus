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
          // We log the error here for observability, but the actual error *response*
          // is handled by the GlobalExceptionFilter — clean separation of concerns.
          this.logger.error({ operationLabel, duration, err }, 'Request failed');
        },
      }),
    );
  }
}
