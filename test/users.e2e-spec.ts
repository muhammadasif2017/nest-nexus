import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/core/prisma/prisma.service';

// Users CRUD lives in GraphQL, not REST, per CLAUDE.md (domain CRUD -> GraphQL).
// All requests go through POST /graphql.
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

  const gql = (query: string, variables?: Record<string, unknown>, token?: string) => {
    const req = request(app.getHttpServer()).post('/graphql').send({ query, variables });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
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

  it('query { me } returns the authenticated user without the password field', async () => {
    const res = await gql('query { me { id email displayName roles } }', undefined, accessToken);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me.email).toBe(credentials.email);
    expect(res.body.data.me).not.toHaveProperty('password');
  });

  it('query { me } without a token returns a GraphQL auth error, HTTP 200', async () => {
    const res = await gql('query { me { id email } }');

    expect(res.status).toBe(200); // GlobalExceptionFilter never changes HTTP status for GraphQL
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].extensions?.code).toBeDefined();
  });

  it('query { user(id) } is public and returns limited fields without auth', async () => {
    const res = await gql(`query { user(id: "${userId}") { id email displayName } }`);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.user.email).toBe(credentials.email);
  });

  it('mutation { updateProfile } updates the caller\'s own displayName', async () => {
    const res = await gql(
      'mutation($input: UpdateUserInput!) { updateProfile(input: $input) { displayName } }',
      { input: { displayName: 'Updated Name' } },
      accessToken,
    );

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.updateProfile.displayName).toBe('Updated Name');
  });

  it('query { users } (admin-only) is rejected for a non-admin user', async () => {
    const res = await gql('query { users { id } }', undefined, accessToken);

    // RolesGuard.canActivate returns false -> Nest throws ForbiddenException
    expect(res.body.errors).toBeDefined();
    expect(res.body.data?.users).toBeUndefined();
  });

  it('query { users } and deactivateUser succeed once the caller has the admin role', async () => {
    await prisma.user.update({ where: { id: userId }, data: { roles: ['user', 'admin'] } });

    // Roles are embedded in the JWT at login time — re-login to pick up the change.
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const adminToken = loginRes.body.accessToken;

    const listRes = await gql('query { users { id email } }', undefined, adminToken);
    expect(listRes.body.errors).toBeUndefined();
    expect(Array.isArray(listRes.body.data.users)).toBe(true);

    const deactivateRes = await gql(
      `mutation { deactivateUser(id: "${userId}") { id isActive } }`,
      undefined,
      adminToken,
    );
    expect(deactivateRes.body.errors).toBeUndefined();
    expect(deactivateRes.body.data.deactivateUser.isActive).toBe(false);
  });
});
