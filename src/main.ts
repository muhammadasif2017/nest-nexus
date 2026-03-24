// src/main.ts
import { NestFactory, Reflector } from '@nestjs/core';
import { VersioningType, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

// Security
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as csurf from 'csurf';
import * as compression from 'compression';
import * as session from 'express-session';
import MongoStore from 'connect-mongo';

// Logging
import { Logger } from 'nestjs-pino'; // or WinstonModule logger

// Global pipes/filters
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Hand off ALL request logging to Pino — disables NestJS's built-in logger
    bufferLogs: true,
  });

  // ── Pull typed config ──────────────────────────────────────────────────────
  const config = app.get(ConfigService);
  const PORT = config.get<number>('app.port', 3000);
  const NODE_ENV = config.get<string>('app.nodeEnv');
  const SESSION_SECRET = config.get<string>('app.sessionSecret');
  const MONGO_URI = config.get<string>('database.uri');
  const CLIENT_ORIGIN = config.get<string>('app.clientOrigin');

  // ── Logger (must be first so early errors are captured) ───────────────────
  app.useLogger(app.get(Logger));

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Only allow requests from the known frontend origin. Credentials: true is
  // required for cookies (sessions) to be sent cross-origin.
  app.enableCors({
    origin: CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

  // ── Helmet ────────────────────────────────────────────────────────────────
  // Sets ~14 security-related HTTP headers in one shot. We relax contentSecurityPolicy
  // only in dev so the GraphQL Playground can load its inline scripts.
  app.use(
    helmet({
      contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: NODE_ENV === 'production',
    }),
  );

  // ── Compression ───────────────────────────────────────────────────────────
  // Gzip all responses. Skip if Content-Type is already binary (images, etc.)
  app.use(compression());

  // ── Cookie Parser ─────────────────────────────────────────────────────────
  // Must come BEFORE csurf so it can read the CSRF cookie from the request.
  app.use(cookieParser());

  // ── Session (Hybrid Auth: session-based path) ──────────────────────────────
  // Sessions are stored in MongoDB to survive server restarts/scale-out.
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: MONGO_URI }),
      cookie: {
        httpOnly: true,           // Prevents JS access — mitigates XSS
        secure: NODE_ENV === 'production', // HTTPS only in prod
        sameSite: 'strict',       // Mitigates CSRF for session cookie
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
      },
    }),
  );

  // ── CSRF Protection ───────────────────────────────────────────────────────
  // Protects all state-mutating routes. The client reads the token from the
  // 'XSRF-TOKEN' cookie and sends it back as 'X-CSRF-Token' header.
  // Note: CSRF is only meaningful for session/cookie-based auth; JWT Bearer
  // routes are naturally CSRF-immune (browsers can't auto-send Bearer headers).
  app.use(
    csurf({
      cookie: {
        httpOnly: false, // Client JS MUST read this cookie to send the header back
        sameSite: 'strict',
        secure: NODE_ENV === 'production',
        key: 'XSRF-TOKEN',
      },
    }),
  );

  // ── Global Prefix & URI Versioning ────────────────────────────────────────
  // All REST routes become /api/v1/... or /api/v2/...
  // GraphQL lives at /graphql (unversioned by convention)
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Global Guards (applied to every route) ───────────────────────────────
  // NOTE: We do NOT register JwtAuthGuard globally here.
  // Instead, routes are "open by default" and we protect them with @UseGuards()
  // or a metadata-driven approach using a custom @Public() decorator.
  // This is safer than accidentally forgetting to mark a route as public.

  // ── Global Pipes ──────────────────────────────────────────────────────────
  // ValidationPipe transforms incoming plain objects into DTO class instances
  // and validates them via class-validator decorators.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,         // Strip unknown properties — prevents mass assignment
      forbidNonWhitelisted: true, // Throw error if unknown props are sent
      transform: true,         // Auto-convert primitives (e.g., "3" → 3)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global Filters ────────────────────────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── Global Interceptors ───────────────────────────────────────────────────
  // ClassSerializerInterceptor respects @Exclude() and @Expose() on DTOs
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new LoggingInterceptor(), // Logs request/response pairs with timing
  );

  await app.listen(PORT);
  console.log(`🚀 Server running at http://localhost:${PORT}/api/v1`);
  console.log(`📡 GraphQL Playground at http://localhost:${PORT}/graphql`);
}

bootstrap();