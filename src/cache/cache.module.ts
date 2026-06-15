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
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('redis.host');
        const port = config.get<number>('redis.port');
        const password = config.get<string | undefined>('redis.password');
        const auth = password ? `:${encodeURIComponent(password)}@` : '';
        return {
          ttl: 5 * 60 * 1000,
          stores: [new KeyvRedis(`redis://${auth}${host}:${port}`)],
        };
      },
    }),
  ],
  exports: [NestCacheModule],
})
export class CacheModule {}
