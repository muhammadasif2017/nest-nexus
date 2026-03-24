import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
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

    // ── Context Detection ────────────────────────────────────────────────────
    // An ExecutionContext can be HTTP, GraphQL, WebSocket, or RPC.
    // We need to handle GraphQL differently because its "request" is a GQL operation,
    // not an HTTP route. context.getType() returns 'http' or 'graphql'.
    const isGraphQL = context.getType<string>() === 'graphql';

    let operationLabel: string;

    if (isGraphQL) {
      // For GraphQL, the meaningful information is the operation name and type
      // (query vs mutation vs subscription), not the HTTP method/URL.
      const gqlCtx = GqlExecutionContext.create(context);
      const info = gqlCtx.getInfo();
      operationLabel = `[GraphQL] ${info.parentType.name}.${info.fieldName}`;
    } else {
      const req = context.switchToHttp().getRequest();
      operationLabel = `[HTTP] ${req.method} ${req.url}`;
    }

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