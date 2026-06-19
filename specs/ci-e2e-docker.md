# Spec: CI Pipeline, E2E Tests, Production Dockerfile

## Objective

Close three production-readiness gaps identified in an audit of the boilerplate:

1. No automated CI — lint/test/build/typecheck only run locally via the pre-commit hook.
2. `npm run test:e2e` is wired to `./test/jest-e2e.json`, but no `test/` directory exists.
3. No Dockerfile — `docker-compose.yml` only provisions infra (postgres, redis, minio, clamav), not the app itself.

Goal: a PR triggers GitHub Actions (lint, typecheck, unit tests, e2e tests against real postgres+redis, build), and the app can be built into a deployable production image.

## Tech Stack

NestJS 11, TypeScript 5.4, Jest 29/30, Prisma 7 (postgres), Node 22 (matches local `node -v` = v22.15.0).

## Commands

```
Lint:       npm run lint
Format:     npm run format:check
Typecheck:  npm run typecheck
Unit tests: npm test
E2E tests:  npm run test:e2e
Build:      npm run build
Docker:     docker build -t nest-nexus .
```

## Project Structure (additions)

```
test/                       → e2e test root (new)
test/jest-e2e.json          → e2e Jest config (new)
test/app.e2e-spec.ts        → health check e2e (new)
test/auth.e2e-spec.ts       → register/login/refresh/logout e2e (new)
test/users.e2e-spec.ts      → users CRUD e2e (new)
test/helpers/               → shared e2e setup (test app bootstrap, db reset) (new)
.github/workflows/ci.yml    → CI pipeline (new)
Dockerfile                  → multi-stage prod build (new)
.dockerignore                → (new)
```

## Code Style

E2E specs follow existing unit-test conventions (see `src/modules/auth/auth.service.spec.ts` for naming), but use `supertest` against a real Nest app instance, e.g.:

```typescript
describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp(); // helpers/test-app.ts — boots AppModule, applies same pipes/filters as main.ts
  });

  afterAll(async () => app.close());

  it('POST /auth/register creates a user', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'e2e@test.com', password: 'Password123!' })
      .expect(201);
  });
});
```

`createTestApp()` helper must replicate `main.ts` bootstrap (ValidationPipe, SerializeInterceptor, GlobalExceptionFilter, helmet, cookie-parser) minus anything dev-only (Bull Board, Swagger optional) — e2e tests should hit the same pipeline as production.

## Testing Strategy

- **Scope (this pass):** critical paths only — health check, auth (register → login → refresh → logout), users CRUD. Proves the harness works end-to-end; other modules (2FA, OAuth, magic-link, sessions, notifications) follow later as separate tasks, not in this spec.
- **Infra:** e2e tests run against real Postgres + Redis (per CLAUDE.md testing section) — no mocking `PrismaService` in e2e, unlike unit tests.
- **DB isolation:** each e2e file resets relevant tables in `beforeEach`/`afterEach` via `PrismaService` (no fixture framework needed at this scale).
- **CI:** GitHub Actions spins up `postgres:16-alpine` and `redis:7-alpine` as job services (matches docker-compose versions), runs `prisma migrate deploy` before e2e suite.

## Boundaries

- **Always:** keep e2e tests scoped to HTTP behavior (status codes, response shape), not internal implementation; reuse `ConfigService`/Zod validation — e2e env vars go through `.env.test` or CI env vars, never hardcoded secrets in the workflow file.
- **Ask first:** changing `prisma migrate deploy` to `migrate dev` in CI (deploy is correct for CI/prod, but flag if schema drift causes friction); adding paid CI minutes-heavy steps (e.g. matrix builds).
- **Never:** commit `.env`/`.env.test` with real secrets; use `latest` tags for CI service containers (pin versions matching docker-compose: `postgres:16-alpine`, `redis:7-alpine`); skip `npm audit` findings silently — note them, don't fix in this spec (out of scope).

## CI Workflow Detail

`.github/workflows/ci.yml`, triggers: `pull_request` + `push` to `main`.

Single job, steps in order (fail fast):
1. checkout
2. setup-node (22.x, npm cache)
3. `npm ci`
4. `npm run lint`
5. `npm run format:check`
6. `npm run typecheck`
7. `npm test -- --coverage`
8. start postgres + redis services (job-level `services:`), `npx prisma migrate deploy`
9. `npm run test:e2e`
10. `npm run build`

## Dockerfile Detail

Multi-stage, `node:22-alpine`:
- **Stage 1 (build):** `npm ci`, `npx prisma generate`, `npm run build`
- **Stage 2 (runtime):** copy `dist/`, `node_modules` (prod only via `npm ci --omit=dev` or copy pruned), `prisma/` (for client + migrate deploy at startup if desired), run as non-root user, `CMD ["node", "dist/main"]`
- `.dockerignore` excludes `node_modules`, `dist`, `.git`, `docs`, `test`, `*.md`, `.env*`

No docker-compose changes — app wiring into docker-compose for local dev is explicitly out of scope per your answer (prod image only).

## Success Criteria

- [ ] `.github/workflows/ci.yml` exists; a test PR shows all 10 steps passing (or correctly failing on a deliberate lint break, to prove the gate works)
- [ ] `npm run test:e2e` passes locally against `docker-compose up -d postgres redis`
- [ ] `docker build -t nest-nexus .` succeeds; `docker run nest-nexus` boots without crashing (env vars supplied)
- [ ] No secrets committed; `.env.test` (if added) is gitignored

## Open Questions

- None blocking — OAuth/2FA/session e2e coverage deferred to a follow-up task, not this spec.
