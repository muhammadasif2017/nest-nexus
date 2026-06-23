# ADR-009: BullMQ for Background Job Processing

## Status
Accepted

## Date
2026-06-16

## Context
The project requires async job processing for:
- Email delivery (magic links, notifications) — must survive process restarts
- Scheduled cleanup (expired tokens, stale records) — separate concern from cron
- Any future long-running work that should not block an HTTP request

Requirements:
- Jobs persist across restarts — in-memory queues are unacceptable for email delivery
- Per-job retry with exponential backoff for transient failures (SMTP provider outages)
- Dead-letter capture for jobs that exhaust all retries
- First-class TypeScript support
- NestJS integration via an official or actively maintained adapter

## Decision
Use BullMQ (`bullmq` + `@nestjs/bullmq`) with Redis as the backing store.

Default job options set at the queue level:
- `attempts: 3` — retries on failure
- `backoff: { type: 'exponential', delay: 2000 }` — 2s, 4s, 8s between retries
- `removeOnComplete: { count: 100 }` — keep the 100 most recent successful jobs for debugging
- `removeOnFail: { count: 500 }` — keep the 500 most recent failed jobs for investigation

Every processor implements `@OnWorkerEvent('failed')` to route final failures to
`DeadLetterService`, ensuring no silent job loss (see CLAUDE.md).

## Alternatives Considered

### Bull (predecessor to BullMQ)
- Pros: Mature, well-documented, large community
- Cons: BullMQ is Bull's rewrite with better TypeScript types, worker-thread support, and
  improved atomicity guarantees; `@nestjs/bullmq` is the official successor adapter;
  Bull is in maintenance mode — new development is in BullMQ
- Rejected: Using a maintenance-mode package when the official successor exists and
  integrates the same way is unnecessary technical debt

### pg-boss (PostgreSQL-backed job queue)
- Pros: Uses PostgreSQL — no additional infrastructure beyond our existing database;
  jobs are ACID-transactional with application data
- Cons: No official NestJS adapter; polling-based (not pub/sub) so latency is bounded
  by poll interval (500ms default); fewer retry configuration options out of the box;
  Prisma + pg-boss would need a raw `pg` connection in parallel (pg-boss manages its
  own schema), adding schema management complexity
- Rejected: Redis is already required (cache, session, cross-instance pub/sub);
  adding pg-boss to save on infrastructure complexity doesn't save anything

### Agenda.js (MongoDB-backed job queue)
- Pros: Feature-rich, supports cron-like scheduling
- Cons: MongoDB-backed — the project migrated away from MongoDB (ADR-008);
  reintroducing MongoDB for queues alone would split infrastructure across two databases
- Rejected: Incompatible with the PostgreSQL migration decision

### @nestjs/schedule only (cron jobs, no queue)
- Pros: Zero extra infrastructure — pure in-process cron
- Cons: Jobs run in-process; a crash during delivery loses the job; no retry mechanism;
  not suitable for work triggered by user actions (e.g., sending a magic-link email
  immediately after a POST request)
- Rejected: In-process cron is not a message queue; the reliability and trigger model
  are fundamentally different

## Consequences
- Redis is required in all environments (development, staging, production). The existing
  Redis instance (used by cache and sessions) serves as the BullMQ backing store — no
  second Redis connection is needed.
- `QUEUE_EMAIL` (and any future queue names) are defined in `src/queues/queues.constants.ts`
  — never inline string literals in `BullModule.registerQueue()` or `@InjectQueue()`.
- `DeadLetterService.handleFailedJob()` must be called in `@OnWorkerEvent('failed')` on
  every processor. Skipping this causes final failures to disappear without any record.
- Job payload types are defined as DTOs in `src/queues/dto/` and validated at enqueue time
  via `satisfies` to catch shape mismatches at compile time.
