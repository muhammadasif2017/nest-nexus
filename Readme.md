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
| **Passkeys** | WebAuthn | Passwordless login + passkey-only signup |
| **M2M auth** | API keys | Machine-to-machine credentials via `X-API-Key` header |
| **Cache** | Redis (ioredis) | Application cache + BullMQ backbone |
| **Queues** | BullMQ | Background jobs, retries, dead-letter |
| **Scheduler** | @nestjs/schedule | Cron jobs with distributed locking |
| **Security** | Helmet, Throttler | Layered HTTP security hardening |
| **Health** | Terminus | Kubernetes-ready liveness/readiness probes |
| **Logging** | Pino | Structured JSON logs with redaction |
| **Containers** | Docker + Compose | Full local stack in one command |

### System overview

```mermaid
flowchart LR
    Client["Client"] -->|"REST /api/v1"| Pipeline["Security pipeline<br/>CORS → Helmet → Compression →<br/>Cookie Parser → Rate Limit → Guards"]
    Pipeline --> Features

    subgraph Features["Feature modules (src/modules)"]
        Auth["auth<br/>JWT · OAuth2 · 2FA · magic links · WebAuthn · API keys"]
        Authz["authorization<br/>RBAC · Scopes · ABAC · ReBAC"]
        Users["users"]
        Docs["document (authz demo)"]
    end

    subgraph Core["Core infrastructure (src/core)"]
        Prisma["PrismaService"]
        Cache["Cache + invalidation"]
        Queues["BullMQ + dead letter"]
        Events["EventEmitter2"]
    end

    Features --> Core
    Prisma --> PG[("PostgreSQL")]
    Cache --> Redis[("Redis")]
    Queues --> Redis
```

## Quick Start

### Prerequisites

- Node.js 22+
- Docker and Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/muhammadasif2017/nest-nexus.git
cd nest-nexus
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

# Queue dashboard — requires an API key even in dev:
# mint one via POST /api/v1/auth/api-keys, then send it in the X-API-Key header
open http://localhost:3000/api/queues
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
├── seed.ts                          # Seeds the first super_admin user
└── migrations/                      # Auto-generated SQL migrations (committed to version control)

prisma.config.ts                     # Prisma 7 runtime config (DATABASE_URL, migrations path) — repo root
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

```mermaid
flowchart TD
    pw["Password login"] --> tfa{"2FA enabled?"}
    tfa -->|"yes"| pending["Pending token<br/>scope: two_factor_pending"] --> verify["POST /auth/2fa/verify"] --> issue
    tfa -->|"no"| issue
    oauth["OAuth2 callback<br/>Google / GitHub / Microsoft"] --> issue
    magic["Magic link verify"] --> issue
    wa["WebAuthn login / signup verify"] --> issue["TokenService<br/>access token (15m) + HttpOnly refresh cookie (7d)"]
    issue --> user["req.user — one shape for every guard"]
    apikey["API key (X-API-Key header)"] -.->|"M2M — no JWT, own guard"| user
```

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

The demo routes and the technique(s) gating each:

| Route | Gated by |
|---|---|
| `POST /documents` | `document:write` scope |
| `GET /documents` | `document:read` scope + DB-level readable filter (pagination over the readable subset) |
| `GET /documents/:id` | scope, then `AuthorizationService.can()` — scope OR visibility OR relation; denied → `404` |
| `GET /documents/:id/preview` | scope AND ABAC policy `document.read` |
| `PATCH /documents/:id` | scope AND `editor` relation |
| `DELETE /documents/:id` | scope AND `owner` relation |
| `POST/DELETE /documents/:id/share` | scope AND `owner` relation (grants/revokes relation tuples) |

```mermaid
flowchart TD
    req["Request hits a /documents route"] --> sa{"super_admin?"}
    sa -->|"yes"| allow["ALLOW — short-circuits every check"]
    sa -->|"no"| stack["Stacked guards — each no-ops without its decorator,<br/>stacked decorators = logical AND"]
    stack --> perm{"PermissionsGuard<br/>@RequirePermission"}
    perm -->|"scope missing"| forbid["403"]
    perm -->|"pass / no-op"| rel{"RelationGuard<br/>@RequireRelation"}
    rel -->|"no tuple (owner ⇒ editor ⇒ viewer)"| forbid
    rel -->|"pass / no-op"| policy{"PolicyGuard<br/>@Policy"}
    policy -->|"denied read"| nf["404 — indistinguishable from missing id"]
    policy -->|"pass / no-op"| handler["Handler<br/>composed decisions via AuthorizationService.can()"]
```

### Refresh token rotation with reuse detection

Every successful refresh issues a new refresh token and invalidates the old one. If an
already-used token shows up again (the signature of a stolen token being replayed), the
entire token *family* is revoked immediately, forcing a full re-login. A single stolen
token can't quietly persist access — the moment it's replayed, the family dies.

Tokens are stored as bcrypt hashes (cost 8) in a dedicated `RefreshToken` table with a
FK to `User`. Cost 8 (vs 12 for passwords) is intentional: cryptographically random tokens
derive their brute-force resistance from entropy, not work factor — keeping rotation latency
low while remaining storage-safe against database compromise.

```mermaid
sequenceDiagram
    participant C as Client
    participant T as TokenService
    participant DB as RefreshToken table

    C->>T: POST /auth/refresh (refresh_token cookie)
    T->>T: 1. verify JWT signature
    T->>DB: 2. find matching bcrypt hash (userId + family)
    alt token was already used — replay of a stolen token
        T->>DB: 3. revoke the entire token family
        T-->>C: 401 — full re-login required
    else token valid
        T->>DB: 4. revoke old token (before issuing — order is deliberate)
        T->>DB: 5. store new token hash
        T-->>C: new access token + new HttpOnly refresh cookie
    end
```

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

### Magic Links

```
POST /api/v1/auth/magic-link/send   → always 200, even for unknown emails (no account enumeration)
                                    → token: crypto.randomBytes(32), stored as SHA-256 hash, 15-min TTL
                                    → email delivered via the `email` queue
GET  /api/v1/auth/magic-link/verify?token=...
                                    → hash matched → cleared immediately (single-use) → issues token pair
```

### WebAuthn / Passkeys

```
Add a passkey to an existing account (JWT required):
POST /api/v1/auth/webauthn/register/options   → challenge stored in Redis (5-min TTL)
POST /api/v1/auth/webauthn/register/verify    → upserts credential — one passkey per user, re-register replaces

Passwordless login (@Public):
POST /api/v1/auth/webauthn/login/options      → always 200, even for unknown emails (no enumeration)
POST /api/v1/auth/webauthn/login/verify       → verifies assertion → issues token pair

Passkey-only signup (@Public — no password ever exists):
POST /api/v1/auth/webauthn/signup/options     → pending state in Redis; no User row created yet
POST /api/v1/auth/webauthn/signup/verify      → creates user (password: null) + credential → issues token pair

DELETE /api/v1/auth/webauthn/credential (JWT) → removes the passkey
```

### API Keys (machine-to-machine)

```
POST   /api/v1/auth/api-keys      (JWT) → user mints a key (many keys per user allowed)
DELETE /api/v1/auth/api-keys/:id  (JWT) → revokes a key

Usage: send the key in the X-API-Key header.
  → ApiKeyGuard protects routes inside Nest's pipeline
  → the same validation runs as Express middleware for non-Nest routes (Bull Board)
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

# View logs for a specific service
docker-compose logs -f app

# Reset all data (destructive)
docker-compose down -v

# Build production image
docker build --target runtime -t nexus:latest .
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

1. Add the queue name constant to `src/core/queues/queues.constants.ts`
2. Register it with `BullModule.registerQueue({ name: QUEUE_YOUR_QUEUE })` in `QueuesModule` (`src/core/queues/queues.module.ts`)
3. Define the job payload type in `src/core/queues/dto/`
4. Create a processor extending `WorkerHost` in `src/core/queues/processors/`
5. Add the `@OnWorkerEvent('failed')` hook pointing to `DeadLetterService`
6. Register the queue in the Bull Board adapter in `main.ts` so it shows up on the dashboard

### Adding a new OAuth provider

1. Install the Passport strategy: `npm install passport-<provider>`
2. Create `src/modules/auth/oauth/strategies/<provider>.strategy.ts`
3. Add credentials to `oauth.config.ts` and `config.validation.ts`
4. Add init + callback CSRF guards in `src/common/guards/oauth-csrf.guard.ts` (follow the Google/GitHub/Microsoft pattern)
5. Add the strategy and guards to `AuthModule` providers
6. Add initiation and callback routes to `oauth.controller.ts`

## Security Checklist

Before deploying to production, verify:

- [ ] All secrets in `.env` are unique, random, and at least 32 characters
- [ ] `NODE_ENV=production` is set (enables HTTPS-only cookies, strict CSP, removes Swagger UI and Bull Board)
- [ ] PostgreSQL is not publicly accessible (firewall rules or VPC)
- [ ] Redis is password-protected (`requirepass` in `redis.conf`)
- [ ] `/api/queues` (Bull Board) is not reachable — it is mounted only when `NODE_ENV !== 'production'`, and is API-key gated even in dev
- [ ] `ALERTS_WEBHOOK_URL` is configured so critical job failures page someone
- [ ] Rate limiting thresholds are tuned for expected traffic patterns
- [ ] `prisma migrate deploy` (not `migrate dev`) is used in production CI pipelines

<p align="center">Built in seven phases, one architectural concern at a time.</p>
