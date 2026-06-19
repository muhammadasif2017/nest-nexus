import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
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
});
