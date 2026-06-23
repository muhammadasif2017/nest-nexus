# ADR-015: Split AuthController into Per-Concern Controllers

## Status
Accepted

## Date
2026-06-17

## Context
`AuthController` had grown to ~275 lines covering five distinct authentication
techniques in one file: core JWT (register/login/refresh/logout), OAuth
(Google/GitHub), TOTP 2FA, magic links, and device-session management. Unlike
session-based auth (ADR-014), all five of these share the same state model —
every flow ends in `AuthService.issueTokens()`/`oauthLogin()` and produces the
same JWT pair. There was no architectural seam to split on, only a readability
problem: one controller, one constructor with five injected services, and a
contributor had to scroll past unrelated techniques to find the one they needed.

## Decision
Split into one controller per technique, all still inside `AuthModule` (this is
the key difference from ADR-014 — same module, same bounded context, just
smaller files):

```
auth/
├── auth.controller.ts          — register, login, refresh, logout, me, sessions
├── oauth/
│   ├── oauth.controller.ts     — google/github + callback
│   └── strategies/google.strategy.ts, github.strategy.ts
├── two-factor/
│   ├── two-factor.controller.ts — 2fa/setup, enable, disable, verify
│   ├── two-factor.service.ts
│   └── dto/two-factor-code.input.ts
└── magic-link/
    ├── magic-link.controller.ts — magic-link/send, verify
    ├── magic-link.service.ts
    └── dto/magic-link.input.ts
```

All four controllers are registered in the single `AuthModule` — no new
`@Module()` boundaries were introduced. Route paths are unchanged (`@Controller`
prefixes recombine to the same URLs, e.g. `OAuthController` + `@Get('google')`
still serves `GET /api/v1/auth/google`).

## Alternatives Considered

### One module per technique (mirroring the session-auth split)
- Pros: maximal isolation, consistent with ADR-014's pattern
- Cons: every new module would just import `AuthModule` to call
  `AuthService.issueTokens()` — pure ceremony, no isolation gained, since all five
  techniques share the same state model and the same final step
- Rejected: module boundaries should track architectural seams (different state
  model, different guard, different middleware — as session auth has), not just
  "this is a different feature." OAuth/2FA/magic-link are entry points into the
  same mechanism, not different mechanisms.

### Leave AuthController as one file, just reorganize internally with comment banners
- Pros: zero new files
- Cons: doesn't fix the actual problem — five injected services in one
  constructor, contributors still scroll through unrelated code, harder to test
  one technique in isolation
- Rejected: comment banners were already in place before this change and the
  module was still hard to navigate

## Consequences
- `AuthModule.providers` and `.controllers` arrays now list more entries, but
  each controller's constructor only injects what it actually uses (e.g.
  `OAuthController` never sees `TwoFactorService`).
- DTOs split along the same lines: `TwoFactorCodeInput` lives in
  `two-factor/dto/`, `MagicLinkSendInput`/`MagicLinkVerifyInput` in
  `magic-link/dto/` — previously both lived in one shared
  `dto/two-factor.input.ts`, which was itself a small instance of the same
  "unrelated things in one file" problem.
- `AuthController`'s constructor dropped from 5 dependencies to 2
  (`AuthService`, `TokenService`) — the class-level `@UseGuards(JwtAuthGuard)`
  was also removed as redundant (it's already applied globally via `APP_GUARD`
  in `app.module.ts`); behavior is unchanged, this just removed a misleading
  duplicate declaration.
- Any new OAuth provider, 2FA method, or similar JWT-issuing technique should
  follow this pattern: its own subfolder controller registered in `AuthModule`,
  not a new top-level module — unless it introduces a genuinely new state model,
  in which case ADR-014's full-module split is the right call instead.
