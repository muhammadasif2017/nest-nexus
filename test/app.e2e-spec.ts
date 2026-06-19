import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

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

  // HealthController has no @Public() — global JwtAuthGuard blocks unauthenticated
  // requests like any other route. Documents current behavior, not desired k8s-probe shape.
  it('GET /api/v1/health/live without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(401);
  });

  it('GET /api/v1/health/ready without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(401);
  });

  it('GET /api/v1/health/deep without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/deep').expect(401);
  });

  it('GET /api/v1/health/live with a malformed bearer token returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  // Uses /ready (db + redis only), not /deep — /deep's disk check requires a
  // drive-letter path on Windows (check-disk-space rejects bare '/'), which only
  // surfaces on Windows dev machines, not Linux CI. /ready already proves the
  // authenticated success path without tripping that platform difference.
  it('GET /api/v1/health/ready with a valid token returns 200 with all checks up', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'e2e-health@test.com',
        displayName: 'E2E Health',
        password: 'P@ssw0rd123!',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .set('Authorization', `Bearer ${registerRes.body.accessToken}`)
      .expect(200);

    expect(res.body.status).toBe('ok');
  });

  it('responses include helmet-set security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
