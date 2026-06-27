import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const CHANNEL = 'cache:invalidation';

// Publisher and subscriber must be separate ioredis connections.
// A connection in subscribe mode can only receive messages — it cannot publish.
@Injectable()
export class CacheInvalidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheInvalidationService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {
    const opts = {
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string | undefined>('redis.password'),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    };
    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_ch: string, raw: string) => {
      let keys: string[];
      try {
        ({ keys } = JSON.parse(raw) as { keys: string[] });
      } catch {
        // Malformed message — log and skip rather than crashing the subscriber.
        this.logger.warn(`Unparseable message on ${CHANNEL}: ${raw}`);
        return;
      }
      // Cross-instance: another pod invalidated these keys, so we do the same locally.
      Promise.all(keys.map((k) => this.cache.del(k))).catch((err) =>
        this.logger.warn({ err }, 'Local key invalidation failed'),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe(CHANNEL);
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  private async invalidate(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.cache.del(k)));
    try {
      await this.publisher.publish(CHANNEL, JSON.stringify({ keys }));
    } catch (err) {
      this.logger.warn({ err }, 'Redis publish failed — cross-instance invalidation skipped');
    }
  }

  @OnEvent('user.created')
  async onUserCreated(): Promise<void> {
    await this.invalidate(['users:all']);
  }

  @OnEvent('user.updated')
  async onUserUpdated(payload: { userId: string }): Promise<void> {
    await this.invalidateUserCache(payload.userId);
  }

  @OnEvent('user.deactivated')
  async onUserDeactivated(payload: { userId: string }): Promise<void> {
    await this.invalidateUserCache(payload.userId);
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    await this.invalidate([`users:id:${userId}`, 'users:all']);
  }
}
