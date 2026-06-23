# ADR-027: Standardize on the `public` Postgres Schema

## Status
Accepted

## Date
2026-06-24

## Context
While adding the authorization feature (ADR-023..026), the new `Document` and
`RelationTuple` tables created by `prisma migrate dev` were invisible to the running
application. Investigation revealed a latent split between how migrations and the runtime
resolved the Postgres schema:

- `DATABASE_URL` contained `?schema=local`.
- **Prisma's migrate/introspect engine honors `?schema=`** → it wrote every table (and the
  `_prisma_migrations` history) into a `local` schema.
- **The runtime uses the `PrismaPg` driver adapter** (`@prisma/adapter-pg`), which connects
  through a plain `pg` Pool. The `pg` driver ignores the `?schema=` query parameter; the
  connection's `search_path` defaulted to `"$user", public`. So the app read and wrote the
  `public` schema.

The real application tables had always lived in `public` (that is where the first six
migrations had been applied and where `_prisma_migrations` tracked them). The `?schema=local`
parameter only affected the migrate engine, so `migrate dev` built a throwaway duplicate of
the entire schema in `local` — a duplicate nothing ever read.

## Decision
Standardize on the `public` schema everywhere.

1. Change `DATABASE_URL` from `?schema=local` to `?schema=public` so the migrate engine and
   the runtime adapter agree.
2. The `public` schema already contained the new tables (created during e2e bring-up) but
   was missing the history row for `20260623192256_add_document_and_relation_tuple`. Record
   it without re-running SQL: `prisma migrate resolve --applied <migration>`.
3. Drop the orphaned `local` schema (a full duplicate created only by the stray
   `migrate dev`): `DROP SCHEMA local CASCADE`.

After this, `prisma migrate status` reports the database up to date and a fresh
`migrate dev` / `migrate deploy` targets the same schema the app reads.

## Alternatives Considered

### Set `search_path` to `local` on the `pg` Pool in `PrismaService`
- Pros: keeps `?schema=local`; one code change
- Cons: makes `local` the canonical schema, orphaning the real data already in `public`;
  the non-standard schema name has no benefit and surprises every tool that defaults to
  `public` (psql, dashboards, backups)
- Rejected: `public` is the conventional default and is where the live data already is

### Leave the split and apply new tables to `public` manually each time
- Pros: no config change
- Cons: every future migration repeats the same trap; migration history diverges from the
  schema the app uses
- Rejected: fixes a symptom, not the cause

## Consequences
- `DATABASE_URL` must use (or omit, which defaults to) `?schema=public`. `.env.example`
  already has no `?schema=` and is correct.
- Driver-adapter caveat recorded for the future: the `PrismaPg` adapter does **not** read
  `?schema=` — schema selection is governed by the connection `search_path`. If a non-default
  schema is ever required, it must be set on the `pg` Pool (e.g. `options=-c search_path=...`
  or `SET search_path`), not via the URL parameter alone.
- The `.env` change is local-only (`.env` is gitignored); this ADR is the durable record of
  the required configuration.
