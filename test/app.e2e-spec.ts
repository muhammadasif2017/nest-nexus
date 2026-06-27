import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/core/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  // Health endpoints are @Public() — no token required (Kubernetes probes carry no auth).
  it('GET /api/v1/health/live returns 200 without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/v1/health/ready returns 200 without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('responses include helmet-set security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
