import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException,
  HttpStatus, Logger,
} from '@nestjs/common';
import { GqlExceptionFilter, GqlArgumentsHost } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { Request, Response } from 'express';
import { MongoError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
import { ThrottlerException } from '@nestjs/throttler';

// ── Custom Error Codes ──────────────────────────────────────────────────────
// These become the `extensions.code` field in GraphQL errors.
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
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter, GqlExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): any {
    // ── Determine execution context ─────────────────────────────────────────
    // host.getType() returns 'http', 'graphql', 'ws', or 'rpc'.
    // We branch here because the error response format is fundamentally different.
    const contextType = host.getType<string>();

    if (contextType === 'graphql') {
      return this.handleGraphQLError(exception, host);
    }

    // Default: treat as HTTP (covers 'http' and unknown contexts)
    return this.handleHttpError(exception, host);
  }

  // ── GraphQL Error Handler ──────────────────────────────────────────────────
  // In GraphQL, we don't touch the HTTP response. Instead, we return a
  // GraphQLError object. Apollo will wrap it in the `errors` array automatically.
  private handleGraphQLError(exception: unknown, host: ArgumentsHost): GraphQLError {
    const { message, code, statusCode } = this.normalizeException(exception);
    const isInternal = statusCode >= 500;

    // Log internal errors with full stack traces for debugging.
    // For client errors (4xx), a warn log is sufficient — they're expected.
    if (isInternal) {
      this.logger.error(
        `[GraphQL] Unhandled exception: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`[GraphQL] Client error: ${code} - ${message}`);
    }

    return new GraphQLError(
      // Never expose internal error details to clients — use a generic message.
      // This prevents accidental leakage of database structure, file paths, etc.
      isInternal ? 'An internal server error occurred.' : message,
      {
        extensions: {
          code,
          // http.status lets Apollo Server set the correct HTTP status even
          // though GraphQL responses are always 200 by default. Some clients
          // (like Apollo Client) use this for retry logic.
          http: { status: statusCode },
          // Only include a timestamp in dev for easier debugging
          ...(process.env.NODE_ENV !== 'production' && {
            timestamp: new Date().toISOString(),
            // Expose the original message in dev so you can debug quickly
            originalMessage: message,
          }),
        },
      },
    );
  }

  // ── HTTP Error Handler ─────────────────────────────────────────────────────
  private handleHttpError(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { message, code, statusCode } = this.normalizeException(exception);
    const isInternal = statusCode >= 500;

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
      ...(process.env.NODE_ENV !== 'production' && isInternal && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    });
  }

  // ── Exception Normalizer ───────────────────────────────────────────────────
  // This is the heart of the filter. It maps any possible exception type
  // (NestJS, Mongoose, MongoDB, unknown) to a consistent {message, code, statusCode}.
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
          : (exceptionResponse as any)?.message ?? exception.message;

      // Map HTTP status codes to our semantic error codes
      const code = this.statusToErrorCode(status);

      // ValidationPipe returns an array of messages — join them for readability
      const normalizedMessage = Array.isArray(message)
        ? message.join('; ')
        : message;

      return { message: normalizedMessage, code, statusCode: status };
    }

    // ── Throttler (Rate Limit) Exception ─────────────────────────────────────
    if (exception instanceof ThrottlerException) {
      return {
        message: 'Too many requests. Please slow down.',
        code: ErrorCode.RATE_LIMITED,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      };
    }

    // ── MongoDB Duplicate Key Error (code 11000) ───────────────────────────
    // Mongoose doesn't wrap this in an HttpException — it surfaces as a raw MongoError.
    // This commonly happens when trying to register with an existing email.
    if (exception instanceof MongoError && (exception as any).code === 11000) {
      const keyPattern = (exception as any).keyValue;
      const field = Object.keys(keyPattern ?? {})[0] ?? 'field';
      return {
        message: `A record with this ${field} already exists.`,
        code: ErrorCode.CONFLICT,
        statusCode: HttpStatus.CONFLICT,
      };
    }

    // ── Mongoose Validation Error ─────────────────────────────────────────
    // Fired when a document fails Mongoose schema-level validation (e.g., required, enum)
    if (exception instanceof MongooseError.ValidationError) {
      const messages = Object.values(exception.errors).map((e) => e.message);
      return {
        message: messages.join('; '),
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      };
    }

    // ── Unknown/Unhandled Exceptions ───────────────────────────────────────
    // This is the safety net. We intentionally return a generic message to
    // avoid leaking any implementation details about the crash.
    const message =
      exception instanceof Error ? exception.message : 'Unknown error';

    this.logger.error('Unhandled exception', exception);

    return {
      message,
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  private statusToErrorCode(status: number): ErrorCode {
    const map: Record<number, ErrorCode> = {
      [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
      [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
    };
    return map[status] ?? ErrorCode.INTERNAL_ERROR;
  }
}