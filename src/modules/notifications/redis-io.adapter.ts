import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;
  private pubClient!: Redis;
  private subClient!: Redis;

  async connectToRedis(opts: { host: string; port: number; password?: string }): Promise<void> {
    this.pubClient = new Redis(opts);
    this.subClient = this.pubClient.duplicate();
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async close(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
