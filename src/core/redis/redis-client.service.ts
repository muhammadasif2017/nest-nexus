import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisClientService implements OnModuleInit, OnModuleDestroy {
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

  // lazyConnect + enableOfflineQueue:false means the connection only opens on the
  // first command, and that command isn't queued while connecting — so without
  // this, the very first Redis-touching request after startup can race the
  // socket open and fail with "Stream isn't writeable". Connecting during Nest's
  // own startup phase closes that window.
  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    // lazyConnect means the client may never have connected (e.g. a request path
    // that never touched Redis) — quit() on an unconnected client throws because
    // enableOfflineQueue is false. disconnect() is safe to call in any state.
    if (this.client.status === 'wait' || this.client.status === 'end') {
      this.client.disconnect();
      return;
    }
    await this.client.quit();
  }
}
