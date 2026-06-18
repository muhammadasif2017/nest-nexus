import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// Config factories (typed, validated)
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import oauthConfig from './config/oauth.config';
import storageConfig from './config/storage.config';
import { configValidationSchema } from './config/config.validation'; // Zod schema

// Infrastructure modules
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { LoggerModule } from './logger/logger.module';
import { QueuesModule } from './queues/queues.module';
import { EventsModule } from './events/events.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';

// Feature modules (one per domain)
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionAuthModule } from './modules/session-auth/session-auth.module';
import { NotificationsModule } from './modules/notifications/notification.module';
import { StorageModule } from './storage/storage.module';
import { GraphQLConfigModule } from './graphql/graphql.module';

@Module({
  imports: [
    // ── Config (MUST be first — everything else depends on it) ──────────────
    // isGlobal: true means you don't need to import ConfigModule in every feature module
    // validationSchema applies Zod/Joi at startup — fail fast if env is misconfigured
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, oauthConfig, storageConfig],
      validate: configValidationSchema, // Throws on startup if .env is invalid
      cache: true, // Caches parsed config in memory — minor perf win
    }),

    // ── Rate Limiting (Throttler) ─────────────────────────────────────────
    // 10 requests per 60 seconds per IP, globally enforced via APP_GUARD below.
    // Individual routes can override with @Throttle({ default: { limit: 3, ttl: 60000 } })
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 60 seconds window (ms)
        limit: 10,
      },
      {
        name: 'strict', // For auth routes: 5 attempts / 10 minutes
        ttl: 600_000,
        limit: 5,
      },
    ]),

    // Infrastructure
    PrismaModule,
    RedisModule,
    CacheModule,
    LoggerModule,
    QueuesModule,
    EventsModule,
    SchedulerModule,
    HealthModule,
    MetricsModule,

    // Feature Modules
    AuthModule,
    SessionAuthModule,
    UsersModule,
    NotificationsModule,
    StorageModule,

    // GraphQL (Apollo + subscriptions + schema generation)
    GraphQLConfigModule,
  ],

  providers: [
    // ThrottlerGuard first — reject rate-limited requests before auth runs
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    // JwtAuthGuard global — all routes require auth by default.
    // Use @Public() to opt individual routes out.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Register filter via DI so ConfigService can be injected into it
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
