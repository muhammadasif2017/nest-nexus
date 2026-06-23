# ADR-008: Migrate from MongoDB/Mongoose to PostgreSQL/Prisma

## Status
Accepted

> **Note (2026-06-23):** The Query Insights integration
> (`@prisma/sqlcommenter-query-insights`) referenced throughout this ADR has since
> been removed from the codebase. The PostgreSQL/Prisma migration decision still
> stands on its other merits (type safety, relational data model, migration
> tooling) — only the Query Insights layer was dropped.

## Date
2026-06-15

## Context
The project's original stack used MongoDB with Mongoose. The immediate trigger
for re-evaluation was the need for `@prisma/sqlcommenter-query-insights`, which
annotates outgoing SQL with trace metadata so Google Cloud SQL's Query Insights
panel can attribute slow queries to the correct application code path.

`@prisma/sqlcommenter-query-insights` is Prisma-specific and targets SQL databases
only. Adopting it required either keeping MongoDB and dropping the feature, or
migrating to a SQL database and getting Prisma's full ecosystem in the deal.

A concurrent review of the data model revealed that the domain was already
relational in practice: users have refresh tokens and OAuth providers, both of
which are FK-linked to the user. MongoDB's document model was being used to embed
these as arrays within the user document — a workaround, not a natural fit.

Requirements for the replacement stack:
- Type-safe database access with schema-derived types (not hand-written interfaces)
- Built-in migration management (not ad-hoc scripts)
- Query Insights support via `@prisma/sqlcommenter-query-insights`
- PostgreSQL-compatible session store to replace `connect-mongo`
- No regression in security properties (bcrypt hashing, token family revocation)

## Decision
Replace MongoDB/Mongoose with PostgreSQL (via `@prisma/adapter-pg`) and the
Prisma ORM (v7). Use `@prisma/sqlcommenter-query-insights` as a Prisma extension
in `PrismaService`.

Key schema design choices:

**Separate `RefreshToken` table (vs embedded array)**
ADR-001 rejected this for MongoDB on the grounds that cross-document joins added
a round-trip. With PostgreSQL, a joined `WHERE userId = ?` query is cheaper than
the MongoDB array scan, and the FK ensures referential integrity. Each row maps
to one token; revocation is an UPDATE on a single row; family revocation is a
single `DELETE WHERE family = ?`.

**Separate `OauthProvider` table**
Same reasoning: a many-to-one relationship maps cleanly to a FK. The composite
unique index `@@unique([provider, providerId])` prevents duplicate bindings that
would have required a Mongoose `$addToSet` workaround.

**`password String?` (nullable)**
OAuth-only users never set a password. Rather than storing a sentinel value or
a separate `hasPassword` boolean as the sole discriminator, the column is nullable.
`hasPassword Boolean @default(true)` is retained for explicit querying without
null checks, but the nullable password is the source of truth.

**`roles String[]` (not a Prisma enum)**
Roles are lowercase strings (`user`, `admin`) matching the existing `role.enum.ts`
file. Using a PostgreSQL array of strings avoids a schema migration every time a
role is added and keeps the application-layer enum as the single source of truth.

**Password hashing moved out of pre-save hook**
Mongoose pre-save hooks ran `bcrypt.hash` transparently. Prisma has no equivalent
hook. Hashing is now explicit in `AuthService.register()` before calling
`prisma.user.create()`. This makes the flow visible in the call graph rather than
hidden in the ORM layer.

**Prisma 7 `prisma.config.ts` (no `url` in `schema.prisma`)**
Prisma 7 removed the `url` property from the `datasource` block in `schema.prisma`.
Connection configuration now lives in `prisma.config.ts` via `defineConfig`, which
also sets the migrations path. This keeps secrets out of the schema file and aligns
with Prisma 7's explicit separation of schema and runtime config.

**`PrismaService` as a `@Global()` module**
`PrismaService` is provided by `PrismaModule` which is decorated `@Global()` so
feature modules (`AuthModule`, `UsersModule`, etc.) do not need to import it
explicitly. This matches the existing pattern for `ConfigModule`.

**Session store**
`connect-mongo` replaced with `connect-pg-simple` using the same `pg.Pool` that
backs Prisma, avoiding a second connection pool. The `createTableIfMissing: true`
option handles the `session` table on first boot without a manual migration.

## Alternatives Considered

### Keep MongoDB, skip Query Insights
- Pros: No migration, no risk
- Cons: Sacrifices observability permanently; the data model was already fighting
  the document model (embedded arrays acting as foreign-key tables)
- Rejected: Query Insights is a hard requirement; the migration also pays off the
  relational-data-in-a-document-store technical debt

### MongoDB with Prisma (via Prisma MongoDB adapter)
- Pros: Gets Prisma's type safety and generated client without changing the database
- Cons: `@prisma/sqlcommenter-query-insights` only works with SQL databases — it
  annotates SQL comments for SQL query analyzers. A MongoDB adapter would not
  satisfy the original requirement. Prisma's MongoDB adapter also lacks
  `prisma.$extends()` support for custom query extensions.
- Rejected: Does not satisfy the primary requirement

### TypeORM with PostgreSQL
- Pros: Mature NestJS integration, `@nestjs/typeorm` decorator-first approach
- Cons: Type safety is weaker than Prisma — `Repository<Entity>` methods accept
  arbitrary JS objects rather than schema-derived types; active-record pattern
  mixes persistence concerns into domain classes; migrations have historically
  had footguns (auto-sync in production)
- Rejected: Prisma's generated client provides stronger compile-time guarantees

### Sequelize with PostgreSQL
- Pros: Most mature SQL ORM in the Node.js ecosystem
- Cons: No first-class TypeScript support in the traditional sense — types are
  inferred at runtime rather than generated at compile time; no Prisma extension
  ecosystem; `@prisma/sqlcommenter-query-insights` is Prisma-only
- Rejected: TypeScript ergonomics and the Query Insights requirement both rule it out

### Drizzle ORM with PostgreSQL
- Pros: Excellent TypeScript types, SQL-like API, very fast
- Cons: No migration UI, no Prisma Studio equivalent; `@prisma/sqlcommenter-query-insights`
  is Prisma-specific; NestJS integration is third-party rather than first-party;
  smaller ecosystem than Prisma at time of decision
- Rejected: Prisma's Query Insights integration is a hard requirement

## Consequences

**Schema-level**
- `User.refreshTokens` embedded array → `RefreshToken` table with FK; see ADR-001
  (superseded by this ADR for storage location; ADR-002 reuse-detection algorithm
  is unchanged and still applies)
- `User.oauthProviders` embedded array → `OauthProvider` table with FK
- Cascading deletes (`onDelete: Cascade`) ensure tokens and OAuth bindings are
  cleaned up automatically when a user is hard-deleted

**Service-level**
- `TokenService.listDeviceSessions()` no longer reads `user.refreshTokens`; it
  queries `RefreshToken` directly with a WHERE filter — this removed an
  unnecessary NotFoundException (user existence is implied by valid tokens)
- `AuthService.register()` now explicitly calls `bcrypt.hash` (was a Mongoose
  pre-save hook); the code is more auditable but requires explicit hashing in any
  future user-creation path (e.g., admin-created accounts, seeding)

**Test-level**
- All unit tests use `PrismaService` mocks instead of Mongoose model mocks
- P2025 (`Record not found`) replaces `null` returns for not-found conditions;
  P2002 (`Unique constraint failed`) replaces MongoError code 11000

**Operational**
- Requires a running PostgreSQL instance (Docker or managed); `docker-compose`
  should be updated to include `postgres` service
- `prisma migrate dev` must be run on first setup; CI should run `prisma migrate deploy`
- `connect-pg-simple` automatically creates the `session` table on startup;
  no separate migration required for session storage
