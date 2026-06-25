# ADR-016: CI Pipeline, E2E Test Harness, and Production Dockerfile

## Status
Accepted

## Date
2026-06-19

## Context
An audit of the boilerplate found three production-readiness gaps:

1. No automated CI — lint/test/build/typecheck only ran locally via the
   pre-commit hook, so a broken PR could merge without anyone catching it.
2. `npm run test:e2e` was already wired to `./test/jest-e2e.json` in
   `package.json`, but no `test/` directory existed — the script failed
   immediately if invoked.
3. No Dockerfile — `docker-compose.yml` only provisions infra (postgres,
   redis, minio, clamav), never the app itself. No deployable image existed.

Goal: a PR triggers GitHub Actions (lint, typecheck, unit tests, e2e tests
against real postgres+redis, build), and the app can be built into a
deployable production image.

## Decision
Three additions, built in dependency order (e2e harness → Dockerfile → CI,
since CI's e2e step needs the harness to exist to be meaningful):

**E2E harness** (`test/`): `test/helpers/test-app.ts` exports
`createTestApp()`, which replicates `main.ts` bootstrap (ValidationPipe,
SerializeInterceptor, GlobalExceptionFilter, helmet, cookie-parser) minus
dev-only wiring (Bull Board, Swagger) — e2e tests hit the same request
pipeline as production. Specs run against **real Postgres + Redis**, no
mocked `PrismaService` (per CLAUDE.md's existing testing section), with
per-suite table resets in `beforeEach`/`afterEach` rather than a fixture
framework. Scope for this pass: health check, auth flow
(register→login→refresh→logout), users CRUD — 2FA/OAuth/magic-link/session
e2e coverage is deferred, not in scope.

**Production Dockerfile**: multi-stage, `node:22-alpine`. Build stage runs
`npm ci`, `npx prisma generate`, `npm run build`; runtime stage carries only
prod deps, runs as non-root user, `CMD ["node", "dist/main"]`. No
docker-compose wiring for the app itself — compose stays infra-only, image
build/run is handled by CI/deployment tooling, not local dev.

**CI workflow** (`.github/workflows/ci.yml`): triggers on `pull_request` +
`push: main`. Single job, fails fast, step order: checkout → setup-node
(22.x) → `npm ci` → `npx prisma generate` → `npm run lint` →
`npm run format:check` → `npm run typecheck` → `npm test -- --coverage` →
postgres:16-alpine + redis:7-alpine as job-level `services:` → `npx prisma
migrate deploy` → `npm run test:e2e` → `npm run build`. Service image
versions are pinned to match `docker-compose.yml` (not `latest`).

## Alternatives Considered

### Fixture framework (e.g. `@databases/pg-test`, factory libraries) for e2e DB state
- Pros: more robust isolation, scales better as e2e coverage grows
- Cons: adds a dependency and abstraction layer for 3 spec files
- Rejected: per-suite table truncation in `beforeEach`/`afterEach` via
  `PrismaService` is sufficient at this scale; revisit if e2e coverage
  expands significantly (OAuth/2FA/sessions follow-up)

### Mock Prisma in e2e tests (consistent with unit test convention)
- Pros: faster, no infra dependency in CI
- Cons: defeats the purpose of e2e — the whole point is verifying the real
  HTTP pipeline against real Postgres/Redis behavior (transactions,
  constraints, session store)
- Rejected: CLAUDE.md already establishes unit tests mock Prisma, e2e tests
  use real infra — this is a deliberate split, not an oversight

### Wire the app into `docker-compose.yml` alongside infra services
- Pros: one command (`docker-compose up`) for full local stack including app
- Cons: out of scope per spec — Dockerfile target was a deployable prod
  image, not a local dev convenience; local dev still runs `npm run start:dev`
  directly against `docker-compose up -d postgres redis` infra
- Rejected: conflates two different goals (prod image vs. local dev
  ergonomics); can be added later as a separate decision if needed

### `prisma migrate dev` instead of `migrate deploy` in CI
- Pros: would auto-generate migrations if schema drifted from committed migrations
- Cons: CI should apply committed migrations exactly, not generate new ones —
  schema drift should fail loudly, not be silently patched over in the
  pipeline
- Rejected: `migrate deploy` only applies existing `prisma/migrations`,
  which is the correct CI/prod behavior; flagged in the spec as something to
  watch for friction, not changed

## Consequences
- `npm run test:e2e` now actually runs (3 spec files: health, auth, users)
  instead of failing on a missing config target.
- CI gate means a broken PR can no longer merge silently — lint, typecheck,
  unit, e2e, and build are all enforced before merge to `main`.
- `npx prisma generate` must run before `npm run typecheck` (and before any
  other Prisma-dependent step) in both CI and local dev — the generated
  client isn't committed, so a fresh checkout/CI runner has no
  `@prisma/client` types until this step runs. This applies locally too: a
  fresh clone needs `npx prisma generate` before `npm run typecheck` will
  pass.
- Production deploys now have a real artifact (`docker build -t nest-nexus .`)
  instead of no containerization story at all.
- 2FA, OAuth, and magic-link flows remain untested at the e2e
  level — same gap as before, just explicitly deferred rather than silently
  missing. ClamAV/MinIO-dependent code paths are also untested in CI (CI job
  services are postgres+redis only, matching e2e scope).
- Any new e2e spec follows the same pattern: real Postgres/Redis via
  `createTestApp()`, table reset in `beforeEach`/`afterEach`, no Prisma
  mocking.
