import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisClientService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string | undefined>('redis.password'),
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
