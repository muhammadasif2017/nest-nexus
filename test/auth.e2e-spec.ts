import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

// register + login are rate-limited (5 per 10 min per IP — see AuthController @Throttle).
// All tests share one registered user and re-login for fresh tokens instead of
// re-registering, to stay well under that limit within a single suite run.
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const credentials = {
    email: 'e2e-auth@test.com',
    displayName: 'E2E Auth User',
    password: 'P@ssw0rd123!',
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(credentials).expect(201);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('POST /api/v1/auth/register creates a new user and returns access token + refresh cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...credentials, email: 'e2e-auth-2@test.com' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe('e2e-auth-2@test.com');
    expect(res.body.user.password).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);
  });

  it('POST /api/v1/auth/register with a duplicate email returns 409', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(credentials).expect(409);
  });

  it('POST /api/v1/auth/login returns access token + refresh cookie for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);
  });

  it('POST /api/v1/auth/login with wrong password returns 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: 'WrongPassword123!' })
      .expect(401);
  });

  it('POST /api/v1/auth/refresh rotates the refresh token and revokes the old one', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const oldCookie = loginRes.headers['set-cookie'][0];

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(200);

    expect(refreshRes.body.accessToken).toBeDefined();
    const newCookie = refreshRes.headers['set-cookie'][0];
    expect(newCookie).not.toBe(oldCookie);

    // Reusing the revoked old refresh token must fail.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);
  });

  it('POST /api/v1/auth/logout revokes refresh tokens and requires a bearer token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const accessToken = loginRes.body.accessToken;
    const cookie = loginRes.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Refresh token revoked by logout must no longer work.
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('POST /api/v1/auth/logout without a bearer token returns 401', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(401);
  });
});
