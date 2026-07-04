# Nexus

NestJS backend implementing five authentication methods side by side: OAuth2, TOTP 2FA, magic links, WebAuthn/passkeys, and API keys. A JWT core with refresh-token rotation and family-based reuse detection sits underneath all of them.

It runs on real infrastructure, not a stub. Postgres/Prisma, Redis, BullMQ with dead-letter handling. The auth flows get exercised against the same production-shaped concerns (connection pooling, queue backpressure, cache invalidation) a real service deals with, instead of a toy harness.

No business domain, on purpose — the subject is authentication, so there's nothing else competing for attention. API surface is REST, documented with OpenAPI/Swagger.

## What's Inside

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | NestJS 11 | Module system, DI container, decorators |
| **Database** | PostgreSQL + Prisma v7 | Primary data store with type-safe, generated client |
| **API** | REST (Swagger/OpenAPI) | Versioned REST surface with generated OpenAPI docs |
| **Auth** | JWT + OAuth2 | Token-based authentication, rotation |
| **Authorization** | RBAC · Scopes · ABAC · ReBAC | Four techniques behind one decision point |
| **2FA** | TOTP (otplib) | Authenticator app support with backup codes |
| **Passwordless** | Magic links | Email-based authentication |
| **Cache** | Redis (ioredis) | Application cache + BullMQ backbone |
| **Queues** | BullMQ | Background jobs, retries, dead-letter |
| **Scheduler** | @nestjs/schedule | Cron jobs with distributed locking |
| **Security** | Helmet, Throttler | Layered HTTP security hardening |
| **Health** | Terminus | Kubernetes-ready liveness/readiness probes |
| **Logging** | Pino | Structured JSON logs with redaction |
| **Containers** | Docker + Compose | Full local stack in one command |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/your-org/nexus.git
cd nexus
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `DATABASE_URL` — see
[Environment Variables](#environment-variables) for the exact format. Everything
else has a safe default for local development.

### 3. Start the infrastructure

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Verify all services are healthy
docker-compose ps
```

### 4. Run database migrations

```bash
# Apply all migrations and generate the Prisma client
npx prisma migrate dev

# (First run only) If the database does not exist yet, Prisma will create it
```

### 5. Run the application

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build && npm start
```

### 6. Verify it's working

```bash
# Health check
curl http://localhost:3000/api/v1/health/ready

# Swagger API docs
open http://localhost:3000/api/docs

# Queue dashboard
open http://localhost:3000/admin/queues
```

## Project Structure

```
src/
├── main.ts                          # Bootstrap: security middleware, versioning
├── app.module.ts                    # Root composition module
│
├── config/                          # Typed, Zod-validated environment config
│   ├── app.config.ts
│   ├── database.config.ts           # DATABASE_URL for Prisma
│   ├── redis.config.ts
│   ├── jwt.config.ts
│   ├── oauth.config.ts
│   ├── alerts.config.ts
│   └── config.validation.ts         # Zod schema — app refuses to start if invalid
│
├── common/                          # Shared, zero-business-logic primitives
│   ├── decorators/                  # @CurrentUser(), @Roles(), @Public(), @AllowPending2FA(),
│   │                                #   @RequirePermission(), @Policy(), @RequireRelation()
│   ├── enums/                       # Role + Permission enums
│   ├── filters/                     # GlobalExceptionFilter (consistent REST envelope)
│   ├── guards/                      # JwtAuthGuard, RolesGuard, PermissionsGuard, PolicyGuard, RelationGuard
│   └── interceptors/                # LoggingInterceptor, SerializeInterceptor
│
├── core/                            # Infrastructure modules
│   ├── prisma/                      # PrismaService wrapper, @Global()
│   ├── cache/                       # Redis CacheModule + CacheInvalidationService
│   ├── redis/                       # Shared Redis connection
│   ├── logger/                      # Pino logger with request redaction
│   ├── events/                      # EventEmitter2 (wildcard, global)
│   ├── queues/                      # BullMQ email queue, processor, dead-letter
│   ├── scheduler/                   # Cron jobs with distributed Redis locking
│   ├── mailer/                      # Email sending
│   └── health/                      # Terminus liveness + readiness + deep checks
│
└── modules/                         # Feature modules — auth-focused, no business domain
    ├── auth/                        # JWT, OAuth2 (Google/GitHub/Microsoft), TOTP, magic links, WebAuthn, API keys
    ├── authorization/              # RBAC/Scopes, ABAC policies, ReBAC tuples — one decision point
    ├── document/                   # Demo resource exercising all four authz techniques
    └── users/                       # REST controller, serialization

prisma/
├── schema.prisma                    # Models: User, RefreshToken, OauthProvider, WebauthnCredential, ApiKey, Document, RelationTuple
├── prisma.config.ts                 # Prisma 7 runtime config (DATABASE_URL, migrations path)
└── migrations/                      # Auto-generated SQL migrations (committed to version control)
```

## Architecture Decisions

### Six security layers, one job each

Every incoming request passes through: CORS → Helmet → Compression → Cookie Parser →
Rate Limiting → Guards. Each layer owns exactly one responsibility. Pull one out and
exactly one dimension of security degrades — the tradeoff is explicit, not hidden.

### Authentication is JWT-first

Stateless Bearer tokens + HttpOnly refresh cookie serve API clients: mobile apps, SPAs,
third-party integrations. OAuth2 callbacks, 2FA, magic links, WebAuthn, and API keys all
converge on the same JWT issuance path, so guards and decorators read from one
`req.user` object regardless of how the user authenticated.

### Authorization is four techniques behind one decision point

Authentication answers *who you are*; authorization answers *what you may do*. The
`document` resource demos four models side by side: **RBAC→Scopes** (roles expand to
permission strings), **ABAC** (named policy predicates over resource attributes), and
**ReBAC** (per-subject/per-object relationship tuples, Zanzibar-lite). Each is a guard
that no-ops unless its decorator is on the route, so stacked decorators read as logical
AND. Object-level decisions a stacked guard can't express (read = `read:any` OR public
visibility OR a `viewer` relation) live in `AuthorizationService.can()`. Denied reads
return `404`, not `403`, so a caller can't enumerate which ids exist. See ADR-023 through
ADR-029.

### Refresh token rotation with reuse detection

Every successful refresh issues a new refresh token and invalidates the old one. If an
already-used token shows up again (the signature of a stolen token being replayed), the
entire token *family* is revoked immediately, forcing a full re-login. A single stolen
token can't quietly persist access — the moment it's replayed, the family dies.

Tokens are stored as bcrypt hashes (cost 8) in a dedicated `RefreshToken` table with a
FK to `User`. Cost 8 (vs 12 for passwords) is intentional: cryptographically random tokens
derive their brute-force resistance from entropy, not work factor — keeping rotation latency
low while remaining storage-safe against database compromise.

### Guards read the request uniformly

`JwtAuthGuard` and `RolesGuard` resolve `req.user` through a shared helper, so the same
guard works across every REST controller.

### The exception filter returns one consistent envelope

A single `GlobalExceptionFilter` catches everything and returns a consistent JSON envelope:
status code, `errorCode`, message, path, and timestamp. Internal 5xx details are masked in
production so stack traces and database structure never leak to clients.

Prisma errors are translated automatically: `P2002` (unique constraint) → 409 Conflict,
`P2025` (record not found on update/delete) → 404 Not Found.

### Cache invalidation is event-driven and cross-instance

When `UsersService.update()` runs, it emits `user.updated` via EventEmitter2.
`CacheInvalidationService` listens for that event, deletes the affected cache keys locally,
and publishes an invalidation message to a Redis Pub/Sub channel. Every other running
instance receives that message and deletes the same keys from their view of the cache.
The stale window is near-zero rather than "up to TTL."

### Cron jobs use distributed locking

Every `@Cron()` handler acquires a Redis lock before doing any work. The lock uses
`SET key value NX PX ttl` (atomic compare-and-set) and releases via a Lua script
(atomic compare-and-delete). If the lock is already held by another instance, the handler
logs and returns immediately. This eliminates duplicate work and phantom concurrency bugs
in horizontally scaled deployments.

### BullMQ jobs have a two-layer failure strategy

Layer 1 is automatic retry with exponential backoff, handling transient failures like
network blips or momentary Redis timeouts. Layer 2 is the dead-letter store: on final
failure the job gets persisted, classified by error type (transient, permanent, external),
and an alert fires for critical queues. From there operators can inspect the job, acknowledge
it, or replay it, all without touching the database directly.

## Authentication Flows

### JWT Login

```
POST /api/v1/auth/login
  → AuthService validates credentials (timing-safe bcrypt)
  → TokenService issues access token (15m) + refresh token (7d)
  → Access token → response body (store in memory, not localStorage)
  → Refresh token → HttpOnly cookie (browser stores automatically)
```

### Token Refresh

```
POST /api/v1/auth/refresh (refresh_token cookie sent automatically)
  → TokenService.rotateRefreshToken()
    → Verify JWT signature
    → Find matching bcrypt hash in RefreshToken table (WHERE userId + family)
    → REUSE DETECTED? → revoke entire token family → force re-login
    → Mark old token isRevoked=true → issue new token pair
  → New refresh token → replaces HttpOnly cookie
  → New access token → response body
```

### OAuth2 (Google / GitHub / Microsoft)

```
GET /api/v1/auth/google          → redirects to Google consent screen
GET /api/v1/auth/google/callback → Passport verifies, OAuthService upserts OauthProvider row
                                 → issues token pair → redirects to frontend
                                   with access token as query param (?token=...)

GitHub and Microsoft follow the same pattern: /auth/github(/callback), /auth/microsoft(/callback)
```

### TOTP Two-Factor

```
POST /api/v1/auth/2fa/setup    → returns QR code URI + raw secret (secret stored encrypted)
POST /api/v1/auth/2fa/enable   → verifies first code → enables 2FA → returns backup codes
POST /api/v1/auth/2fa/disable  → verifies a code → disables 2FA

On login (2FA enabled):
  → Password valid → issue 2FA pending token (scope: 'two_factor_pending')
  → POST /api/v1/auth/2fa/verify → code valid → issue full auth tokens
```

## Queue Architecture

### Job lifecycle

```
producer.add(jobName, data)
  → BullMQ.add with default options (attempts: 3, exponential backoff from 2s,
    removeOnComplete: keep last 100)

Worker.process()
  → Exponential backoff retry on failure
  → On final failure (attemptsMade >= maxAttempts):
      → DeadLetterService.handleFailedJob() — persists the failed job for inspection
```

### Queues

One queue is implemented: `email` (concurrency 5), handling welcome, password-reset,
email-verification, 2FA-code, and magic-link messages.

| Queue | Concurrency | Purpose |
|---|---|---|
| `email` | 5 | Welcome, password reset, email verification, 2FA code, magic link |

## Observability

### Endpoints

| Endpoint | Purpose | Kubernetes role |
|---|---|---|
| `GET /api/v1/health/live` | Is the process alive and not OOM? | Liveness probe |
| `GET /api/v1/health/ready` | Are all dependencies reachable? | Readiness probe |
| `GET /api/v1/health/deep` | Full dependency diagnostics | Manual inspection |

## Environment Variables

See `.env.example` for the complete annotated reference. Required variables:

```bash
JWT_SECRET              # 64-char random hex
JWT_REFRESH_SECRET      # 64-char random hex (different from JWT_SECRET)
DATABASE_URL            # postgresql://user:password@host:5432/dbname
```

Optional variables enable additional features:

```bash
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET    # Enables Google OAuth
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET    # Enables GitHub OAuth
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET # Enables Microsoft OAuth
ALERTS_WEBHOOK_URL                         # Enables Slack/webhook job failure alerts
```

## Scripts

```bash
npm run start:dev     # Development server with hot reload
npm run start:debug   # Development server with debugger attached
npm run build         # Compile TypeScript → dist/
npm start             # Run compiled application
npm test              # Jest unit tests
npm run test:e2e      # End-to-end tests
npm run test:cov      # Tests with coverage report
npm run typecheck     # TypeScript type check without emitting
npm run lint          # ESLint with auto-fix

npx prisma migrate dev          # Create and apply a new migration (dev)
npx prisma migrate deploy       # Apply pending migrations (CI / production)
npx prisma studio               # Browse and edit data in the browser
npx prisma generate             # Regenerate the Prisma client after schema changes
```

## Docker Commands

```bash
# Start full local stack
docker-compose up -d

# Start only infrastructure (run app locally for hot reload)
docker-compose up -d postgres redis

# Start with observability stack
docker-compose --profile observability up -d

# View logs for a specific service
docker-compose logs -f app

# Reset all data (destructive)
docker-compose down -v

# Build production image
docker build --target production -t nexus:latest .
```

## Extending the Project

These are extension points, not features actually built into the repo. Documenting
them was part of the exercise itself — a reader (or future me) should be able to see
how a new module, queue, or OAuth provider slots in without guessing. The
feature-module steps below use a hypothetical `orders` module to show the pattern;
no such module exists in the codebase.

### Adding a new feature module

```bash
# NestJS CLI generates the module scaffold
nest generate module modules/orders
nest generate service modules/orders
nest generate controller modules/orders
```

Follow the existing module pattern:

1. Add the model to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add-orders` to generate and apply the migration
3. Define input DTOs in `dto/` with class-validator decorators
4. Define the output DTO in `dto/` with `@Expose()`
5. Implement the service — inject `PrismaService` directly (it's `@Global()`)
6. Emit domain events via `EventEmitter2` after every mutation
7. Implement the controller
8. Register the module in `app.module.ts`

### Adding a new queue

1. Add the queue name constant to `src/queues/queues.constants.ts`
2. Register it with `BullModule.registerQueue({ name: QUEUE_YOUR_QUEUE })` in `QueuesModule`
3. Create a producer service in `queues/producers/`
4. Create a processor extending `WorkerHost` in `queues/processors/`
5. Add the `@OnWorkerEvent('failed')` hook pointing to `DeadLetterService`
6. Add the queue to `QueueManagerService.getQueueMetrics()` for monitoring

### Adding a new OAuth provider

1. Install the Passport strategy: `npm install passport-<provider>`
2. Create `src/modules/auth/strategies/<provider>.strategy.ts`
3. Add credentials to `oauth.config.ts` and `config.validation.ts`
4. Add the strategy to `AuthModule` providers
5. Add initiation and callback routes to `oauth.controller.ts`

## Security Checklist

Before deploying to production, verify:

- [ ] All secrets in `.env` are unique, random, and at least 32 characters
- [ ] `NODE_ENV=production` is set (enables HTTPS-only cookies, strict CSP, removes Swagger UI and Bull Board)
- [ ] PostgreSQL is not publicly accessible (firewall rules or VPC)
- [ ] Redis is password-protected (`requirepass` in `redis.conf`)
- [ ] `/admin/queues` (Bull Board) is behind IP allowlist or admin-only auth
- [ ] `ALERTS_WEBHOOK_URL` is configured so critical job failures page someone
- [ ] Rate limiting thresholds are tuned for expected traffic patterns
- [ ] `prisma migrate deploy` (not `migrate dev`) is used in production CI pipelines

<p align="center">Built in seven phases, one architectural concern at a time.</p>
