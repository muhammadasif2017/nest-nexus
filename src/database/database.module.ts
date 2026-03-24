import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    // forRootAsync lets us inject ConfigService, so the URI is read
    // from the validated config rather than process.env directly.
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('database.uri'),

        // ── Connection Pool & Timeout Settings ──────────────────────────────
        // These are production-grade defaults — tune based on your workload.
        maxPoolSize: 10,          // Max concurrent connections to MongoDB
        serverSelectionTimeoutMS: 5000, // Fail fast if MongoDB is unreachable
        socketTimeoutMS: 45000,   // How long to wait for a socket response
        connectTimeoutMS: 10000,  // Initial connection timeout

        // ── Auto-Index (disable in production for performance) ───────────────
        // In dev, Mongoose auto-creates indexes defined in your schemas.
        // In prod, manage indexes via migrations to avoid blocking startup.
        autoIndex: config.get('app.nodeEnv') !== 'production',
      }),
    }),
  ],
})
export class DatabaseModule {}