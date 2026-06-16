import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { prismaQueryInsights } from '@prisma/sqlcommenter-query-insights';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const pool = new Pool({
      connectionString: config.get<string>('database.url')!,
      max: config.get<number>('database.poolMax'),
    });
    super({ adapter: new PrismaPg(pool), comments: [prismaQueryInsights()] });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
