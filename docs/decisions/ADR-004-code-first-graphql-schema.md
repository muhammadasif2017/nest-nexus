# ADR-004: Code-First GraphQL Schema Generation

## Status
Accepted

## Date
2026-06-15

## Context
NestJS Apollo supports two approaches to GraphQL schema authoring:
- **Schema-first**: write SDL (`.graphql` files), generate TypeScript types from them
- **Code-first**: decorate TypeScript classes, generate SDL from them

We need to pick one and apply it consistently across all resolvers and types.

## Decision
Use code-first with `autoSchemaFile: join(process.cwd(), 'src/schema.graphql')`.
DTOs are TypeScript classes decorated with both `@ObjectType()`/`@InputType()` (for
GraphQL) and `@Expose()`/class-validator decorators (for serialization and
validation). The generated SDL is committed to version control.

## Alternatives Considered

### Schema-first
- Pros: SDL is the contract; teams can design the API before writing code;
  SDL tooling (linting, mocking) is mature
- Cons: Requires maintaining SDL files and generated TypeScript types in sync;
  two sources of truth for the same type (SDL + TS interface); NestJS code-first
  is the documented first-class path, schema-first is secondary
- Rejected: Dual maintenance burden outweighs the design-first benefit in a
  TypeScript-native project where the code IS the design

### Code-first with in-memory schema (no file output)
- Pros: Simpler — no schema file to manage
- Cons: Frontend teams can't run codegen without starting the server; schema
  diffs are invisible in PRs
- Rejected: `src/schema.graphql` in git gives frontend teams a stable codegen
  target and makes schema changes visible in code review

## Consequences
- `sortSchema: true` is set so the generated file is deterministic — schema
  field ordering doesn't create spurious git diffs.
- DTOs serve double duty: they define both the GraphQL type and the
  serialization shape (via `SerializeInterceptor`). Adding a field requires one
  change, not two.
- Resolvers must import from `@nestjs/graphql` for `@Query`, `@Mutation`,
  `@Args`, etc. — not from the Apollo package directly.
- `src/schema.graphql` must be regenerated after any DTO or resolver change.
  CI should verify that the committed schema matches the generated one.
