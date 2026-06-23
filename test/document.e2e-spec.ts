import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb } from './helpers/test-app';
import { PrismaService } from '../src/core/prisma/prisma.service';

// Documents exercise all four authz techniques under /api/v1/documents.
describe('Document authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let strangerToken: string;
  let strangerId: string;

  const owner = { email: 'e2e-owner@test.com', displayName: 'Owner', password: 'P@ssw0rd123!' };
  const stranger = {
    email: 'e2e-stranger@test.com',
    displayName: 'Stranger',
    password: 'P@ssw0rd123!',
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.relationTuple.deleteMany();
    await prisma.document.deleteMany();
    await resetDb(prisma);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanup();

    const o = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(owner)
      .expect(201);
    ownerToken = o.body.accessToken;

    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(stranger)
      .expect(201);
    strangerToken = s.body.accessToken;
    strangerId = s.body.user.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const createDoc = (token: string, visibility = 'private') =>
    request(app.getHttpServer())
      .post('/api/v1/documents')
      .set(auth(token))
      .send({ title: 'T', body: 'B', visibility })
      .expect(201);

  it('rejects unauthenticated access with 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/documents').expect(401);
  });

  it('owner can create and read its own private document', async () => {
    const { body } = await createDoc(ownerToken);
    expect(body.ownerId).toBeDefined();
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${body.id}`)
      .set(auth(ownerToken))
      .expect(200);
  });

  it('stranger gets 403 reading a private document (no relation, ABAC denies)', async () => {
    const { body } = await createDoc(ownerToken);
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${body.id}`)
      .set(auth(strangerToken))
      .expect(403);
  });

  it('ABAC: stranger can preview a public document but not a private one', async () => {
    const pub = await createDoc(ownerToken, 'public');
    const priv = await createDoc(ownerToken, 'private');

    await request(app.getHttpServer())
      .get(`/api/v1/documents/${pub.body.id}/preview`)
      .set(auth(strangerToken))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/documents/${priv.body.id}/preview`)
      .set(auth(strangerToken))
      .expect(403);
  });

  it('list returns only documents the caller may read', async () => {
    await cleanup();
    // re-register users wiped by cleanup
    const o = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(owner)
      .expect(201);
    ownerToken = o.body.accessToken;
    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(stranger)
      .expect(201);
    strangerToken = s.body.accessToken;
    strangerId = s.body.user.id;

    await createDoc(ownerToken, 'private');
    const pub = await createDoc(ownerToken, 'public');

    const { body } = await request(app.getHttpServer())
      .get('/api/v1/documents')
      .set(auth(strangerToken))
      .expect(200);

    const ids = body.map((d: { id: string }) => d.id);
    expect(ids).toContain(pub.body.id); // public readable
    expect(ids).toHaveLength(1); // private one excluded
  });

  it('ReBAC: stranger cannot update until granted editor, then can', async () => {
    const { body: doc } = await createDoc(ownerToken);

    await request(app.getHttpServer())
      .patch(`/api/v1/documents/${doc.id}`)
      .set(auth(strangerToken))
      .send({ title: 'Hacked' })
      .expect(403);

    // owner shares editor relation
    await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/share`)
      .set(auth(ownerToken))
      .send({ subjectId: strangerId, relation: 'editor' })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/api/v1/documents/${doc.id}`)
      .set(auth(strangerToken))
      .send({ title: 'Edited' })
      .expect(200);
  });

  it('ReBAC: editor cannot delete (needs owner relation); owner can', async () => {
    const { body: doc } = await createDoc(ownerToken);
    await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/share`)
      .set(auth(ownerToken))
      .send({ subjectId: strangerId, relation: 'editor' })
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/v1/documents/${doc.id}`)
      .set(auth(strangerToken))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/documents/${doc.id}`)
      .set(auth(ownerToken))
      .expect(204);
  });

  it('only the owner can share a document', async () => {
    const { body: doc } = await createDoc(ownerToken);
    await request(app.getHttpServer())
      .post(`/api/v1/documents/${doc.id}/share`)
      .set(auth(strangerToken))
      .send({ subjectId: strangerId, relation: 'viewer' })
      .expect(403);
  });
});
