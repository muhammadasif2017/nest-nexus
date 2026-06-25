import { NestFactory, Reflector } from '@nestjs/core';
import { VersioningType, ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_EMAIL } from './core/queues/queues.constants';
import { ApiKeyService } from './modules/auth/api-key/api-key.service';
import { createApiKeyExpressMiddleware } from './common/guards/api-key.guard';

import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Hand off ALL request logging to Pino — disables NestJS's built-in logger
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const PORT = config.get<number>('app.port', 3000);
  const NODE_ENV = config.get<string>('app.nodeEnv');
  const isDev = NODE_ENV !== 'production';
  const CLIENT_ORIGIN = config.get<string>('app.clientOrigin');

  app.useLogger(app.get(Logger));

  // Credentials: true is required for cookies (sessions) to be sent cross-origin.
  app.enableCors({
    origin: CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-API-Key'],
  });

  // Sets ~14 security-related HTTP headers in one shot. We relax contentSecurityPolicy
  // only in dev so the Swagger UI can load its inline scripts.
  app.use(
    helmet({
      contentSecurityPolicy: isDev ? false : undefined,
      crossOriginEmbedderPolicy: !isDev,
    }),
  );

  // Gzip all responses. Skip if Content-Type is already binary (images, etc.)
  app.use(compression());

  // Must come BEFORE csurf so it can read the CSRF cookie from the request.
  app.use(cookieParser());

  // ── Global Prefix & URI Versioning ────────────────────────────────────────
  // All REST routes become /api/v1/... or /api/v2/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

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

  // ── Global Interceptors ───────────────────────────────────────────────────
  // ClassSerializerInterceptor respects @Exclude() and @Expose() on DTOs.
  // LoggingInterceptor uses @InjectPinoLogger so it's registered via APP_INTERCEPTOR in AppModule.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('nest-nexus API')
      .setDescription('REST endpoints for nest-nexus.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addCookieAuth(
        'refresh_token',
        { type: 'apiKey', in: 'cookie', name: 'refresh_token' },
        'refresh-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    // Bull Board — queue monitoring UI at /api/queues
    const bullBoardAdapter = new ExpressAdapter();
    bullBoardAdapter.setBasePath('/api/queues');
    createBullBoard({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queues: [new BullMQAdapter(app.get<Queue>(getQueueToken(QUEUE_EMAIL))) as any],
      serverAdapter: bullBoardAdapter,
    });

    const apiKeyService = app.get(ApiKeyService);
    app.use(
      '/api/queues',
      createApiKeyExpressMiddleware(apiKeyService),
      bullBoardAdapter.getRouter(),
    );
  }

  app.enableShutdownHooks();

  await app.listen(PORT);
  console.log(`🚀 Server running at http://localhost:${PORT}/api/v1`);
  if (isDev) {
    console.log(`📖 Swagger docs at http://localhost:${PORT}/api/docs`);
    console.log(`🐂 Bull Board at http://localhost:${PORT}/api/queues`);
  }
}

bootstrap();
