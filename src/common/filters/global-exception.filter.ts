import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

// ── Custom Error Codes ──────────────────────────────────────────────────────
// These become the `errorCode` field in the REST error envelope.
// Clients can switch on these codes for precise error handling,
// rather than parsing brittle human-readable message strings.
export enum ErrorCode {
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// @Catch() with no arguments catches EVERYTHING — handled and unhandled.
// This is intentional: we want no exception to ever escape and expose a raw
// Node.js stack trace to the client.
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    this.isDev = this.config.get<string>('app.nodeEnv') !== 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): any {
    return this.handleHttpError(exception, host);
  }

  // ── HTTP Error Handler ─────────────────────────────────────────────────────
  private handleHttpError(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { message, code, statusCode } = this.normalizeException(exception);
    const isInternal = this.isInternalError(statusCode);

    if (isInternal) {
      this.logger.error(
        `[HTTP] ${request.method} ${request.url} - ${statusCode}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Consistent REST error response envelope.
    // Every single error from this API looks exactly like this — predictable for clients.
    response.status(statusCode).json({
      statusCode,
      errorCode: code,
      message: isInternal ? 'An internal server error occurred.' : message,
      path: request.url,
      timestamp: new Date().toISOString(),
      // In development, include the stack trace so you can debug without logs
      ...(this.isDev &&
        isInternal && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
    });
  }

  // ── Exception Normalizer ───────────────────────────────────────────────────
  // This is the heart of the filter. It maps any possible exception type
  // (NestJS, Prisma, unknown) to a consistent {message, code, statusCode}.
  private normalizeException(exception: unknown): {
    message: string;
    code: ErrorCode;
    statusCode: number;
  } {
    // ── NestJS HttpException (covers most expected application errors) ───────
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // getResponse() can return either a string or an object (from ValidationPipe)
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : ((exceptionResponse as any)?.message ?? exception.message);

      // Map HTTP status codes to our semantic error codes
      const code = this.statusToErrorCode(status);

      // ValidationPipe returns an array of messages — join them for readability
      const normalizedMessage = Array.isArray(message) ? message.join('; ') : message;

      return { message: normalizedMessage, code, statusCode: status };
    }

    // ── Prisma Known Request Errors ────────────────────────────────────────
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        // Unique constraint violation — log field server-side, return generic message to client
        const fields = (exception.meta?.target as string[]) ?? [];
        this.logger.warn({ fields }, 'P2002 unique constraint violation');
        return {
          message: 'A record with this value already exists.',
          code: ErrorCode.CONFLICT,
          statusCode: HttpStatus.CONFLICT,
        };
      }
      if (exception.code === 'P2025') {
        // Record not found — e.g., update/delete on a missing row
        return {
          message: 'Record not found.',
          code: ErrorCode.NOT_FOUND,
          statusCode: HttpStatus.NOT_FOUND,
        };
      }
    }

    // ── Unknown/Unhandled Exceptions ───────────────────────────────────────
    // This is the safety net. We intentionally return a generic message to
    // avoid leaking any implementation details about the crash.
    const message = exception instanceof Error ? exception.message : 'Unknown error';

    this.logger.error('Unhandled exception', exception);

    return {
      message,
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private isInternalError(statusCode: number): boolean {
    return statusCode >= 500;
  }

  private statusToErrorCode(status: number): ErrorCode {
    const map: Record<number, ErrorCode> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
      [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
    };
    return map[status] ?? ErrorCode.INTERNAL_ERROR;
  }
}
