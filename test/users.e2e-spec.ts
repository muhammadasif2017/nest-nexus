import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/core/prisma/prisma.service';

// Users CRUD lives under the REST /api/v1/users routes.
describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  const credentials = {
    email: 'e2e-users@test.com',
    displayName: 'E2E Users',
    password: 'P@ssw0rd123!',
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(credentials)
      .expect(201);
    accessToken = registerRes.body.accessToken;
    userId = registerRes.body.user.id;
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  it('GET /users/me returns the authenticated user without the password field', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(credentials.email);
    expect(res.body).not.toHaveProperty('password');
  });

  it('GET /users/me without a token returns HTTP 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/me');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('GET /users/:id requires auth — returns 401 without a token', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/users/${userId}`);
    expect(res.status).toBe(401);
  });

  it('GET /users/:id returns limited fields for an authenticated caller', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(credentials.email);
    expect(res.body).not.toHaveProperty('password');
  });

  it("PATCH /users/me updates the caller's own displayName", async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Updated Name' })
      .expect(200);

    expect(res.body.displayName).toBe('Updated Name');
  });

  it('GET /users (admin-only) is rejected for a non-admin user with 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('GET /users and DELETE /users/:id succeed once the caller has the admin role', async () => {
    await prisma.user.update({ where: { id: userId }, data: { roles: ['user', 'admin'] } });

    // JwtStrategy sources roles from the DB but caches them per-user for 30s.
    // setRoles() emits user.updated to clear that cache; this direct DB write
    // bypasses the service, so emit the same event to invalidate the stale entry.
    app.get(EventEmitter2).emit('user.updated', { userId });

    // The existing access token already works — roles come from the DB, not the
    // token — but re-login to confirm a fresh token carries the new roles too.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const adminToken = loginRes.body.accessToken;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    const deactivateRes = await request(app.getHttpServer())
      .delete(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(deactivateRes.body.isActive).toBe(false);
  });
});
