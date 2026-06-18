# Implementation Plan: CI Pipeline, E2E Tests, Production Dockerfile

Spec: `specs/ci-e2e-docker.md`

## Overview

Six tasks, three phases. E2E harness first (foundation other e2e specs depend on), then Dockerfile (independent, parallel-safe), then CI workflow last (wires test+build steps together, needs e2e tests to exist for step 9 to be meaningful).

## Architecture Decisions

- E2E helper (`createTestApp`) replicates `main.ts` bootstrap minus dev-only wiring (Bull Board, Swagger) — keeps e2e faithful to prod request pipeline without dragging in infra not needed for HTTP-level tests.
- DB isolation via per-suite table resets in `beforeEach`/`afterEach`, not a fixture framework — matches "critical paths only" scope, avoids over-engineering for 3 spec files.
- Dockerfile and CI are independent of each other (CI step 10 is `npm run build`, not `docker build`) — can be built in either order or parallel.

## Task List

### Phase 1: E2E Foundation

- [ ] **Task 1: E2E harness — jest config + test app bootstrap helper**
  - Acceptance: `test/jest-e2e.json` exists and matches `*.e2e-spec.ts`; `test/helpers/test-app.ts` exports `createTestApp()` returning a booted `INestApplication` with ValidationPipe, SerializeInterceptor, GlobalExceptionFilter, helmet, cookie-parser applied (mirrors `main.ts`); helper also exports `resetDb(prisma)` truncating tables used by e2e specs
  - Verify: `npm run test:e2e` runs (0 spec files found is fine at this point, must not error on config)
  - Files: `test/jest-e2e.json`, `test/helpers/test-app.ts`
  - Dependencies: None
  - Size: S

- [ ] **Task 2: E2E — health check spec**
  - Acceptance: `test/app.e2e-spec.ts` boots app via `createTestApp()`, asserts `GET /health` returns 200 with expected shape
  - Verify: `npm run test:e2e` passes this file against `docker-compose up -d postgres redis`
  - Files: `test/app.e2e-spec.ts`
  - Dependencies: Task 1
  - Size: XS

### Checkpoint: Phase 1

- [ ] Harness boots without error, health e2e passes against real postgres+redis

### Phase 2: E2E Critical Paths + Docker

- [ ] **Task 3: E2E — auth flow (register → login → refresh → logout)**
  - Acceptance: `test/auth.e2e-spec.ts` covers register (201), duplicate register (409 via P2002), login (200, sets refresh cookie), refresh (200, new token pair, old token revoked), logout (200); uses `resetDb` in `afterEach` to clear users/refresh-token tables
  - Verify: `npm run test:e2e -- auth` passes; rerun twice in a row to confirm DB reset works (no leftover-state failures)
  - Files: `test/auth.e2e-spec.ts`
  - Dependencies: Task 1
  - Size: M

- [ ] **Task 4: E2E — users CRUD**
  - Acceptance: `test/users.e2e-spec.ts` covers authenticated create/read/update/delete on `/users` (or GraphQL equivalent per existing resolver), asserts password field never present in response (Serialize/Expose contract holds in e2e, not just unit tests)
  - Verify: `npm run test:e2e -- users` passes
  - Files: `test/users.e2e-spec.ts`
  - Dependencies: Task 1
  - Size: S/M

- [ ] **Task 5: Production Dockerfile**
  - Acceptance: multi-stage `Dockerfile` (build: `node:22-alpine`, `npm ci`, `npx prisma generate`, `npm run build`; runtime: prod deps only, non-root user, `CMD ["node", "dist/main"]`); `.dockerignore` excludes `node_modules`, `dist`, `.git`, `docs`, `test`, `*.md`, `.env*`
  - Verify: `docker build -t nest-nexus .` succeeds; `docker run --env-file .env.example nest-nexus` boots without crashing (will fail on missing live DB connection — acceptable, confirms process starts and config validation passes)
  - Files: `Dockerfile`, `.dockerignore`
  - Dependencies: None (parallel-safe with Tasks 1-4)
  - Size: S

### Checkpoint: Phase 2

- [ ] All e2e specs pass locally (`npm run test:e2e`) against `docker-compose up -d postgres redis`
- [ ] `docker build` succeeds

### Phase 3: CI

- [ ] **Task 6: GitHub Actions CI workflow**
  - Acceptance: `.github/workflows/ci.yml` triggers on `pull_request` + `push: main`; single job running in order: checkout → setup-node(22.x) → `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm test -- --coverage` → spin up `postgres:16-alpine`+`redis:7-alpine` job services → `npx prisma migrate deploy` → `npm run test:e2e` → `npm run build`; fails fast on first failing step
  - Verify: open a throwaway PR (or push to a branch) with a deliberate lint break, confirm the workflow fails at the lint step; revert the break, confirm full green run
  - Files: `.github/workflows/ci.yml`
  - Dependencies: Tasks 1-4 (e2e suite must exist and pass for step to be meaningful)
  - Size: S/M

### Checkpoint: Complete

- [ ] CI green on a real PR
- [ ] All Success Criteria in `specs/ci-e2e-docker.md` checked off

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| E2E tests flaky due to shared DB state across parallel Jest workers | Medium | Run `test:e2e` with `--runInBand` (single worker) in both local script and CI |
| `prisma migrate deploy` in CI drifts from local dev migrations | Medium | CI uses same `prisma/migrations` committed to repo — no schema generation in CI, only apply |
| ClamAV/MinIO-dependent code paths untested in e2e (only postgres+redis services in CI) | Low | Out of scope per spec — flagged, not blocking this pass |

## Open Questions

None blocking — proceed to implementation task by task.
