import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { GraphQLError } from 'graphql';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter, ErrorCode } from './global-exception.filter';

// ── Mock helpers ─────────────────────────────────────────────────────────────

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
  _status?: number;
  _body?: Record<string, unknown>;
}

const makeMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn().mockImplementation((s: number) => { res._status = s; return res; }),
    json: jest.fn().mockImplementation((b: Record<string, unknown>) => { res._body = b; }),
  };
  return res;
};

const httpHost = (
  method = 'GET',
  url = '/test',
  res = makeMockResponse(),
): { host: ArgumentsHost; res: MockResponse } => ({
  host: {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method, url }),
    }),
  } as unknown as ArgumentsHost,
  res,
});

const gqlHost = (): ArgumentsHost =>
  ({ getType: () => 'graphql' }) as unknown as ArgumentsHost;

const makePrismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: '7.0.0',
    meta,
  });

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => { filter = new GlobalExceptionFilter(); });

  // ── Routing ───────────────────────────────────────────────────────────────

  describe('catch() routing', () => {
    it('returns GraphQLError for graphql context', () => {
      const result = filter.catch(new NotFoundException(), gqlHost());
      expect(result).toBeInstanceOf(GraphQLError);
    });

    it('calls response.json() for http context', () => {
      const { host, res } = httpHost();
      filter.catch(new NotFoundException(), host);
      expect(res.json).toHaveBeenCalled();
    });

    it('calls response.json() for unknown context type', () => {
      const { host, res } = httpHost();
      (host as any).getType = () => 'rpc';
      filter.catch(new NotFoundException(), host);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ── HTTP — exception type mapping ─────────────────────────────────────────

  describe('HTTP handler — exception types', () => {
    const catch_ = (exception: unknown, method = 'GET', url = '/test') => {
      const { host, res } = httpHost(method, url);
      filter.catch(exception, host);
      return res._body!;
    };

    it('maps HttpException (string response) correctly', () => {
      const body = catch_(new HttpException('Bad input', HttpStatus.BAD_REQUEST));
      expect(body.statusCode).toBe(400);
      expect(body.message).toBe('Bad input');
    });

    it('maps HttpException (object response) — uses message field', () => {
      const body = catch_(
        new HttpException({ message: 'custom object message', error: 'Bad Request' }, 400),
      );
      expect(body.message).toBe('custom object message');
    });

    it('maps HttpException (array message from ValidationPipe) — joins with "; "', () => {
      const body = catch_(
        new HttpException({ message: ['field1 error', 'field2 error'] }, 400),
      );
      expect(body.message).toBe('field1 error; field2 error');
    });

    it('maps NotFoundException → 404 NOT_FOUND', () => {
      const body = catch_(new NotFoundException('Resource missing'));
      expect(body.statusCode).toBe(404);
      expect(body.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('maps UnauthorizedException → 401 UNAUTHENTICATED', () => {
      const body = catch_(new UnauthorizedException());
      expect(body.statusCode).toBe(401);
      expect(body.errorCode).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('maps ForbiddenException → 403 FORBIDDEN', () => {
      const body = catch_(new ForbiddenException());
      expect(body.statusCode).toBe(403);
      expect(body.errorCode).toBe(ErrorCode.FORBIDDEN);
    });

    it('maps ConflictException → 409 CONFLICT', () => {
      const body = catch_(new ConflictException());
      expect(body.statusCode).toBe(409);
      expect(body.errorCode).toBe(ErrorCode.CONFLICT);
    });

    it('maps UnprocessableEntityException → 422 VALIDATION_ERROR', () => {
      const body = catch_(new UnprocessableEntityException());
      expect(body.statusCode).toBe(422);
      expect(body.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('maps ThrottlerException → 429 RATE_LIMITED', () => {
      const body = catch_(new ThrottlerException());
      expect(body.statusCode).toBe(429);
      expect(body.errorCode).toBe(ErrorCode.RATE_LIMITED);
    });

    it('maps PrismaClientKnownRequestError P2002 → 409 CONFLICT with field name', () => {
      const err = makePrismaError('P2002', { target: ['email'] });
      const body = catch_(err);
      expect(body.statusCode).toBe(409);
      expect(body.errorCode).toBe(ErrorCode.CONFLICT);
      expect(body.message).toContain('email');
    });

    it('maps PrismaClientKnownRequestError P2002 with no target → uses "field" fallback', () => {
      const err = makePrismaError('P2002', {});
      const body = catch_(err);
      expect(body.message).toContain('field');
    });

    it('maps PrismaClientKnownRequestError P2025 → 404 NOT_FOUND', () => {
      const err = makePrismaError('P2025');
      const body = catch_(err);
      expect(body.statusCode).toBe(404);
      expect(body.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('maps unknown Error → 500 INTERNAL_ERROR', () => {
      const body = catch_(new Error('Something exploded'));
      expect(body.statusCode).toBe(500);
      expect(body.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('maps non-Error unknown → 500 INTERNAL_ERROR', () => {
      const body = catch_('a raw string thrown');
      expect(body.statusCode).toBe(500);
      expect(body.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });

  // ── HTTP — response shape ─────────────────────────────────────────────────

  describe('HTTP handler — response shape', () => {
    it('sets status code on response', () => {
      const { host, res } = httpHost();
      filter.catch(new NotFoundException(), host);
      expect(res._status).toBe(404);
    });

    it('includes path from request.url', () => {
      const { host, res } = httpHost('GET', '/api/users');
      filter.catch(new NotFoundException(), host);
      expect(res._body!.path).toBe('/api/users');
    });

    it('includes timestamp in response', () => {
      const { host, res } = httpHost();
      filter.catch(new NotFoundException(), host);
      expect(res._body!.timestamp).toBeDefined();
      expect(typeof res._body!.timestamp).toBe('string');
    });

    it('masks internal 5xx message as generic string', () => {
      const { host, res } = httpHost();
      filter.catch(new Error('DB connection string: secret'), host);
      expect(res._body!.message).toBe('An internal server error occurred.');
    });

    it('exposes 4xx message directly', () => {
      const { host, res } = httpHost();
      filter.catch(new NotFoundException('User not found'), host);
      expect(res._body!.message).toContain('User not found');
    });

    describe('dev vs prod — stack trace', () => {
      const originalEnv = process.env.NODE_ENV;
      afterEach(() => { process.env.NODE_ENV = originalEnv; });

      it('omits stack in production', () => {
        process.env.NODE_ENV = 'production';
        const { host, res } = httpHost();
        filter.catch(new Error('crash'), host);
        expect(res._body!.stack).toBeUndefined();
      });

      it('includes stack in development for 5xx', () => {
        process.env.NODE_ENV = 'development';
        const { host, res } = httpHost();
        filter.catch(new Error('crash'), host);
        expect(res._body!.stack).toBeDefined();
      });

      it('omits stack in development for 4xx', () => {
        process.env.NODE_ENV = 'development';
        const { host, res } = httpHost();
        filter.catch(new NotFoundException(), host);
        expect(res._body!.stack).toBeUndefined();
      });
    });
  });

  // ── GraphQL handler ───────────────────────────────────────────────────────

  describe('GraphQL handler', () => {
    const catchGql = (exception: unknown): GraphQLError =>
      filter.catch(exception, gqlHost()) as GraphQLError;

    it('returns a GraphQLError instance', () => {
      expect(catchGql(new NotFoundException())).toBeInstanceOf(GraphQLError);
    });

    it('sets extensions.code', () => {
      const err = catchGql(new UnauthorizedException());
      expect(err.extensions.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('sets extensions.http.status', () => {
      const err = catchGql(new NotFoundException());
      expect((err.extensions.http as any).status).toBe(404);
    });

    it('masks internal 5xx message', () => {
      const err = catchGql(new Error('secret crash details'));
      expect(err.message).toBe('An internal server error occurred.');
    });

    it('exposes 4xx message directly', () => {
      const err = catchGql(new NotFoundException('Item not found'));
      expect(err.message).toContain('Item not found');
    });

    it('maps ThrottlerException → 429 RATE_LIMITED in GQL', () => {
      const err = catchGql(new ThrottlerException());
      expect((err.extensions.http as any).status).toBe(429);
      expect(err.extensions.code).toBe(ErrorCode.RATE_LIMITED);
    });

    it('maps PrismaClientKnownRequestError P2002 → 409 CONFLICT in GQL', () => {
      const err = catchGql(makePrismaError('P2002', { target: ['email'] }));
      expect((err.extensions.http as any).status).toBe(409);
      expect(err.extensions.code).toBe(ErrorCode.CONFLICT);
    });

    describe('dev vs prod — originalMessage', () => {
      const originalEnv = process.env.NODE_ENV;
      afterEach(() => { process.env.NODE_ENV = originalEnv; });

      it('includes originalMessage in development for 5xx', () => {
        process.env.NODE_ENV = 'development';
        const err = catchGql(new Error('real crash message'));
        expect((err.extensions as any).originalMessage).toBe('real crash message');
      });

      it('omits originalMessage in production', () => {
        process.env.NODE_ENV = 'production';
        const err = catchGql(new Error('real crash message'));
        expect((err.extensions as any).originalMessage).toBeUndefined();
      });

      it('includes timestamp in development', () => {
        process.env.NODE_ENV = 'development';
        const err = catchGql(new Error('crash'));
        expect((err.extensions as any).timestamp).toBeDefined();
      });

      it('omits timestamp in production', () => {
        process.env.NODE_ENV = 'production';
        const err = catchGql(new Error('crash'));
        expect((err.extensions as any).timestamp).toBeUndefined();
      });
    });
  });
});
