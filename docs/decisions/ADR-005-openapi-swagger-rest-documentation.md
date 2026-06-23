# ADR-005: OpenAPI/Swagger for REST Documentation

## Status
Accepted

## Date
2026-06-15

## Context
The project exposes REST endpoints at `/api/v1/*`. Without generated
documentation, developers must rely on reading source code or maintaining
separate Postman collections. The auth surface is non-trivial: two auth flows
(JWT + session), two refresh mechanisms, and HttpOnly cookie semantics that are
easy to misconfigure in clients.

## Decision
Add `@nestjs/swagger` to generate an OpenAPI 3.0 specification from decorator
metadata. The Swagger UI is served at `/api/docs` **in non-production environments
only**.

Key design choices:
- `@ApiProperty()` decorators on DTO fields alongside class-validator decorators —
  single source of truth for each DTO's shape, validation, and documentation.
- Two auth schemes registered: `BearerAuth` (JWT access token) and
  `CookieAuth` (refresh token HttpOnly cookie). Each endpoint declares which
  scheme it uses via `@ApiBearerAuth` / `@ApiCookieAuth`.
- `persistAuthorization: true` in Swagger UI options so the access token
  survives page reloads during development sessions.
- Production guard: `NODE_ENV !== 'production'` check around `SwaggerModule.setup()`.
  The Swagger bundle is never served in production — it adds no dependency risk
  since the package is in `dependencies` (not `devDependencies`), but the route
  is simply never registered.

## Alternatives Considered

### Postman / Insomnia collections
- Pros: No code change; existing tooling many teams already use
- Cons: Must be maintained separately from code; drift is inevitable; no
  schema validation; can't be generated from types
- Rejected: Documentation that lives outside the codebase rots

### No REST documentation
- Pros: Zero overhead
- Cons: Auth flows with HttpOnly cookies and CSRF semantics are non-obvious;
  every new developer or integration author reads source code
- Rejected: The auth surface is exactly the kind of thing that benefits from
  interactive documentation

### Redoc (render-only, no try-it-out)
- Pros: Cleaner UI, better for sharing externally
- Cons: No interactive "try it" for auth flow testing; Swagger UI's try-it-out
  is the primary dev value here
- Rejected: Dev productivity is the goal; Redoc can be added later alongside
  Swagger if external publishing becomes a need

## Consequences
- Every new REST controller needs `@ApiTags`, `@ApiOperation`, and
  `@ApiResponse` decorators.
- Every DTO used by a REST controller needs `@ApiProperty()` on each field.
- Helmet CSP is disabled in non-production so the Swagger UI can load its inline
  scripts — no additional Helmet config needed.
- The OpenAPI spec at `/api/docs/json` is the full API contract for the project.
