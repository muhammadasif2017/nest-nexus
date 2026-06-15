// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// Config factories (typed, validated)
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import oauthConfig from './config/oauth.config';
import storageConfig from './config/storage.config';
import { configValidationSchema } from './config/config.validation'; // Zod schema

// Infrastructure modules
import { DatabaseModule } from './database/database.module';
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
import { NotificationsModule } from './modules/notifications/notification.module';
import { StorageModule } from './storage/storage.module';

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
    DatabaseModule,
    CacheModule,
    LoggerModule,
    QueuesModule,
    EventsModule,
    SchedulerModule,
    HealthModule,
    MetricsModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    NotificationsModule,
    StorageModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}