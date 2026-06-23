# ADR-017: Group Infrastructure Modules Under src/core/

## Status
Accepted

## Date
2026-06-19

## Context
`src/` previously had a flat layout: domain feature modules lived under
`src/modules/<domain>/` (per CLAUDE.md's established convention), but
infrastructure singletons — `cache/`, `redis/`, `prisma/`, `health/`,
`metrics/`, `storage/`, `queues/`, `scheduler/`, `events/`, `logger/` — sat
as siblings directly under `src/`, indistinguishable at a glance from
`common/`, `config/`, `graphql/`, and `modules/`.

This made the top-level `src/` listing noisy (15+ entries) and didn't signal
which folders are app-wide infrastructure (one instance, injected everywhere)
versus domain modules (one per business entity) versus generic reusable
utilities (`common/`). Community convention for mid-to-large NestJS codebases
(feature-based structure, not layered) consistently separates these into a
`core/` directory — infra/app-wide singletons — distinct from `modules/`.

## Decision
Move all infrastructure singleton modules into `src/core/`:

```
src/core/
├── cache/        CacheInvalidationService, CacheModule
├── events/       EventsModule (EventEmitter2 wiring)
├── health/       HealthController, PrismaHealthIndicator, RedisHealthIndicator
├── logger/       LoggerModule (nestjs-pino wiring)
├── metrics/      MetricsInterceptor, Prometheus metric constants
├── prisma/       PrismaService, PrismaModule
├── queues/       QueuesModule, DeadLetterService, BullMQ processors
├── redis/        RedisClientService, RedisModule
├── scheduler/    SchedulerModule, RedisLockService, cron jobs
└── storage/      StorageService, ImageService, ClamAvService, UploadController
```

`src/graphql/` (Apollo/schema wiring) stays at top level — it's transport-layer
wiring for the API surface itself, not an injectable infra singleton consumed
by other modules, so it doesn't fit the same category.

All relative imports referencing the moved folders (both inbound from
`modules/*` and `app.module.ts`/`main.ts`, and outbound from the moved files
themselves to `common/`/`modules/`) were updated. No behavior change —
verified via `tsc --noEmit`, `eslint`, full Jest suite (556 tests), and
`nest build`, all clean.

## Alternatives Considered

### Leave the flat structure
- Pros: zero migration risk, no import churn
- Cons: `src/` keeps growing flatter as more infra singletons are added;
  no visual signal distinguishing "inject this everywhere" infra from
  "one per domain" feature modules
- Rejected: the existing `src/modules/<domain>/` convention already proves
  the team values structural grouping by category — infra deserved the same

### Use a `src/infrastructure/` name instead of `src/core/`
- Pros: more explicit name
- Cons: `core/` is the more common convention in NestJS community examples
  and is shorter
- Rejected: naming preference only, no functional difference

### Fold src/graphql/ into src/core/ as well
- Pros: consistency — everything non-domain lives under core/
- Cons: GraphQL module wiring is closer to `main.ts`'s REST middleware setup
  (transport/API-surface configuration) than to an injectable service like
  `PrismaService` or `RedisClientService` — nothing else in the app imports
  from `graphql/`, unlike every other core/ module
- Rejected: kept at top level; revisit if this judgment call doesn't hold up

## Consequences
- New infra singletons (e.g. a future mail service, S3-compatible alt
  storage) belong in `src/core/<name>/`, not flat under `src/`.
- `src/` top level now only has: `app.module.ts`, `main.ts`, `common/`,
  `config/`, `core/`, `graphql/`, `modules/`, `schema.graphql` — a much
  shorter, more legible index of what kind of thing each folder is.
- No path aliases exist in `tsconfig.json` (pure relative imports), so any
  future folder move repeats this same import-fixing exercise. Worth
  reconsidering path aliases (`@core/*`, `@modules/*`) if more moves like
  this happen.
- `test/` e2e specs and helpers also reference `src/core/prisma/prisma.service`
  now — `tsconfig.json`'s `exclude: ["**/*.spec.ts"]` does not cover
  `*.e2e-spec.ts`, but e2e tests run under a separate `tsconfig.spec.json`
  with `diagnostics: false`, so a stale e2e import is only caught at Jest
  runtime, not by `tsc --noEmit`. This was missed once during the move and
  caught by CI; worth keeping in mind for any future restructure.
