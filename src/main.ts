import { NestFactory, Reflector } from '@nestjs/core';
import { VersioningType, ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import compression from 'compression';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

import { Logger } from 'nestjs-pino';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

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
  const DATABASE_URL = config.get<string>('database.url');
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

  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET is not defined in environment variables');
  }

  // ── Session (Hybrid Auth: session-based path) ──────────────────────────────
  // Sessions are stored in PostgreSQL to survive server restarts/scale-out.
  const PgSession = connectPgSimple(session);
  const pgPool = new Pool({ connectionString: DATABASE_URL });

  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: new PgSession({ pool: pgPool, createTableIfMissing: true }),
      cookie: {
        httpOnly: true,
        secure: NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
      },
    }),
  );

  // ── CSRF Protection ───────────────────────────────────────────────────────
  // Double-submit cookie pattern: server sets XSRF-TOKEN cookie; client JS
  // reads it and sends the value back as X-CSRF-Token header on mutating requests.
  // JWT Bearer routes are naturally CSRF-immune (browsers can't auto-send
  // Bearer headers), so CSRF protection matters primarily for session-based routes.
  const { doubleCsrfProtection } = doubleCsrf({
    getSecret: () => SESSION_SECRET!,
    // Ties the token to the session ID so token fixation is not possible.
    getSessionIdentifier: (req) => req.session?.id ?? req.ip ?? '',
    cookieName: 'XSRF-TOKEN',
    cookieOptions: {
      httpOnly: false, // Client JS must read this to send as header
      sameSite: 'strict',
      secure: NODE_ENV === 'production',
    },
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
  });
  app.use(doubleCsrfProtection);

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
      whitelist: true, // Strip unknown properties — prevents mass assignment
      forbidNonWhitelisted: true, // Throw error if unknown props are sent
      transform: true, // Auto-convert primitives (e.g., "3" → 3)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global Filters ────────────────────────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── Global Interceptors ───────────────────────────────────────────────────
  // ClassSerializerInterceptor respects @Exclude() and @Expose() on DTOs.
  // LoggingInterceptor uses @InjectPinoLogger so it's registered via APP_INTERCEPTOR in AppModule.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // ── Swagger (non-production only) ─────────────────────────────────────────
  if (NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('nest-nexus API')
      .setDescription('REST endpoints for nest-nexus. GraphQL lives at /graphql.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addCookieAuth('refresh_token', { type: 'apiKey', in: 'cookie', name: 'refresh_token' }, 'refresh-token')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(PORT);
  console.log(`🚀 Server running at http://localhost:${PORT}/api/v1`);
  console.log(`📡 GraphQL Playground at http://localhost:${PORT}/graphql`);
  if (NODE_ENV !== 'production') {
    console.log(`📖 Swagger docs at http://localhost:${PORT}/api/docs`);
  }
}

bootstrap();
