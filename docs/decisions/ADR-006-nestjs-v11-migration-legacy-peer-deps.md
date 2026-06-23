# ADR-006: NestJS v11 Migration and .npmrc legacy-peer-deps

## Status
Accepted

## Date
2026-06-15

## Context
The project's initial `package.json` had a mixed dependency tree: `@nestjs/common`
was pinned to `^10.3.0` while `@nestjs/core`, `@nestjs/platform-express`, and most
other NestJS packages were already at `^11.x`. This caused `npm install` to fail
with `ERESOLVE` errors because the v11 packages declare `@nestjs/common@^11` as a
peer dependency.

Additionally, several NestJS ecosystem packages that are compatible with v11 at
runtime have not yet updated their `peerDependencies` declarations to include v11
(e.g., `nestjs-pino`, `@willsoto/nestjs-prometheus`). Strict npm peer dep
resolution rejects these even though the packages work correctly.

## Decision
1. Bump all NestJS core packages to their v11-compatible versions:
   - `@nestjs/common`: `^10.3.0` → `^11.0.0`
   - `@nestjs/axios`: `^3.0.2` → `^4.0.0`
   - `@nestjs/jwt`: `^10.2.0` → `^11.0.0`
   - `@nestjs/passport`: `^10.0.3` → `^11.0.0`

2. Add `.npmrc` with `legacy-peer-deps=true` to suppress peer dependency
   resolution errors for ecosystem packages that are compatible with v11 but
   haven't updated their `peerDependencies` declarations.

## Alternatives Considered

### Stay on NestJS v10
- Pros: No migration work; ecosystem packages have full v10 declarations
- Cons: The project already had v11 packages installed (`@nestjs/core@11.x`,
  `@nestjs/platform-express@11.x`) — the tree was already broken; staying on v10
  would require downgrading those packages too
- Rejected: The project was already partially on v11; completing the migration is
  less work than reverting it

### Use `npm install --force` without .npmrc
- Pros: No persistent config change
- Cons: Requires every developer (and every CI run) to remember the flag; breaks
  `npm install` in the default case
- Rejected: Configuration should live in the repo, not in tribal knowledge

### Wait for ecosystem packages to update peer dep declarations
- Pros: Clean resolution without any flags
- Cons: Indeterminate timeline; packages like `nestjs-pino` may take months to
  publish a new release just to update a peer dep string; the packages already
  work with v11 at runtime
- Rejected: Blocking on cosmetic peer dep declarations is not worth the cost

## Consequences
- `npm install` works without flags for all developers and CI.
- `npm audit` may report peer dep warnings for packages that declare `^10` but
  work with `^11` — these are false positives and can be ignored.
- Any new NestJS ecosystem package added to the project should be evaluated for
  v11 runtime compatibility, not just peer dep declaration compatibility.
- When ecosystem packages publish v11-compatible releases, their version
  constraints in `package.json` should be updated and re-evaluated for whether
  `legacy-peer-deps` is still needed.
