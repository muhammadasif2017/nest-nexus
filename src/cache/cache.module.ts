import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';

@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: 5 * 60 * 1000, // 5 minutes default TTL
        stores: [
          new KeyvRedis(
            `redis://${config.get<string>('redis.host')}:${config.get<number>('redis.port')}`,
          ),
        ],
      }),
    }),
  ],
  exports: [NestCacheModule],
})
export class CacheModule {}
