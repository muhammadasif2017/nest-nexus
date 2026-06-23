# ADR-018: Production Deploy Topology — Oracle Free Tier VM

## Status
Accepted

## Date
2026-06-19

## Context
Needed a production deployment target with zero hosting budget. Chosen
infra: Oracle Cloud "Always Free" tier, `VM.Standard.E2.1.Micro` shape —
1 OCPU, 1GB RAM, Ubuntu. That RAM ceiling is the dominant constraint: the
full local `docker-compose.yml` stack (app + Postgres + Redis + MinIO +
ClamAV + Prometheus + Grafana) does not fit. ClamAV alone needs ~1-2GB
resident; Prometheus/Grafana add more on top. Deploy must also fit the
existing two-stage CI model — `ci.yml` (lint/typecheck/test/build) runs
first, deploy only proceeds if that succeeds, on pushes to `main`.

Additional constraint: `main.ts` sets session cookies `secure: true` in
production (`isDev` check) — this only works behind real HTTPS, not a bare
IP over HTTP.

## Decision
**Split the stack**: Postgres moves off the VM entirely (external managed
Neon Postgres, free tier). Redis stays on the VM as a container — its
footprint (~10-30MB idle, capped via `--maxmemory 128mb`) is negligible
next to ClamAV/Postgres. ClamAV, Prometheus, and Grafana are dropped from
the production topology — not disabled-but-present, removed from
`docker-compose.prod.yml` entirely. They remain available for local testing
via the existing `docker-compose.yml`.

**New file: `docker-compose.prod.yml`** — three services: `app` (image
pulled from GHCR, not built on the VM — a `nest build` + `npm ci` on 1GB
RAM risks OOM), `redis`, and `caddy` (reverse proxy, automatic Let's
Encrypt TLS). Caddy reads the public hostname via `{$BACKEND_DOMAIN}` env
var substitution (Caddy's native syntax) rather than a hardcoded domain in
the `Caddyfile` — keeps the file environment-agnostic.

**New file: `.github/workflows/deploy.yml`** — triggers on `workflow_run`
of the `CI` workflow completing successfully on `main` (not a direct `push`
trigger), so deploy is structurally gated behind the existing test/lint/
build pipeline. Two jobs: build+push image to `ghcr.io/<repo>:latest`, then
SSH to the VM to run `prisma migrate deploy` followed by
`docker compose up -d`.

**App-level config**: `CLAMAV_ENABLED=false` in the VM's `.env` — the
service already supports this flag (`src/core/storage/clamav.service.ts`)
for local dev without Docker; reused here for the same reason (ClamAV
absent from the runtime).

## Alternatives Considered

### Run Postgres in a container on the VM
- Pros: no external dependency, no managed-DB account needed
- Cons: Postgres itself needs a meaningful memory floor, and would compete
  with the app process and Redis for the same 1GB — leaves no headroom
- Rejected: external managed Postgres (Neon) removes the single biggest
  memory consumer from the VM at zero cost

### Keep ClamAV, drop something else instead
- Pros: virus scanning stays active for uploads
- Cons: ClamAV's resident memory alone approaches the VM's total RAM;
  no combination of trade-offs makes it fit on a 1GB box without swapping
  constantly
- Rejected: accepted as a known gap (see Consequences) rather than forcing
  it onto hardware that can't support it

### Build the Docker image on the VM itself (`docker compose build`)
- Pros: no GHCR dependency, simpler permissions story
- Cons: `npm ci` + `nest build` on 1 OCPU/1GB risks OOM-kill mid-build,
  and ties deploy time to the VM's weak CPU
- Rejected: build on GitHub's runners (free, fast, no resource ceiling),
  ship only the finished image to the VM

### `deploy.yml` triggers on `push: main` directly (parallel to CI, not gated on it)
- Pros: simpler trigger, no `workflow_run` indirection
- Cons: user's explicit requirement was test-CI-then-deploy-CI in sequence;
  a parallel trigger could deploy a broken build if CI is still running
- Rejected: `workflow_run` with `types: [completed]` + checking
  `conclusion == 'success'` is the correct primitive for "only after CI
  passes"

### Nginx instead of Caddy for the reverse proxy
- Pros: more ubiquitous, more configuration examples available
- Cons: nginx has no built-in ACME/Let's Encrypt automation — needs
  certbot as a separate cron-renewed dependency, more moving parts on a
  resource-constrained box
- Rejected: Caddy's automatic HTTPS (issue + renew, zero extra config)
  is a meaningfully smaller operational surface for a single low-RAM VM

## Consequences
- Uploaded files are not virus-scanned in production — accepted risk.
  Revisit if the VM is ever resized off the free tier.
- No Prometheus/Grafana in production — no live metrics dashboard for this
  deployment. (At decision time the app still exposed a `/metrics` endpoint;
  the metrics feature has since been removed from the project entirely, so
  there is no `/metrics` endpoint to scrape anywhere now.)
- Postgres connection now crosses the public internet to Neon's pooler
  endpoint instead of a local socket/container — adds network latency per
  query, acceptable trade-off for zero DB hosting cost.
- `docker-compose.prod.yml` and `Caddyfile` are not auto-synced to the VM
  by `deploy.yml` — only the app image is pulled. Changes to either file
  require a manual `git pull`/copy on the VM. Known gap, not yet automated.
- First deploy requires manual steps (VM bootstrap: Docker install, swap,
  firewall, `.env` creation, GHCR auth) kept in a local-only runbook. Every
  deploy after that is automatic via `deploy.yml` on merge to `main`.
- `BACKEND_DOMAIN` env var is now a required production env var (consumed
  by `Caddyfile` via `{$BACKEND_DOMAIN}`) — must be set in the VM's `.env`,
  not validated by `config.validation.ts` since Caddy reads it directly,
  not through NestJS's `ConfigService`.
