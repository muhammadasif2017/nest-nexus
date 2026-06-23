# ADR-014: Split Session-Based Auth into SessionAuthModule

## Status
Accepted (amends ADR-010's module organization; does not change the underlying
JWT + session decision)

## Date
2026-06-17

## Context
ADR-010 established JWT and session auth as parallel flows, both implemented inside
`AuthModule`/`AuthController`. In practice this meant one controller carried two
unrelated auth mechanisms: JWT (Bearer token, stateless, used by most REST)
and session (HttpOnly cookie, server-side state, `req.session`-based). Guards,
middleware (CSRF), and serialization differed per mechanism but lived side by side
in the same files.

This had two concrete costs:
- **Readability** — a contributor reading `AuthController` had to mentally track
  which routes used `req.user` (JWT) vs `req.session` (session) vs `req.session`-as-OAuth-state.
- **A real bug shipped as a result**: `POST /auth/session/logout` carried a comment
  claiming "session guard handles auth" but `SessionGuard` was never applied via
  `@UseGuards()` — the route was `@Public()` with no auth check at all. The guard
  existed (`src/common/guards/session.guard.ts`) but nothing wired it. Mixing two
  auth approaches in one module made this kind of gap easy to miss in review.

## Decision
Extract session-based auth into its own module: `src/modules/session-auth/`.

- `SessionAuthController` (`@Controller('auth/session')`) — owns `POST /login` and
  `POST /logout` only. Same URLs as before (`/api/v1/auth/session/*`), so no client
  contract change.
- `SessionGuard` and `SessionSerializer` move into this module — they are
  session-only concerns and have no reason to live under `src/modules/auth/`.
- `SessionAuthModule` imports `AuthModule` for `AuthService` (credential checking is
  shared — both flows validate the same email/password against the same user
  record). This is a one-directional dependency: session-auth depends on JWT-auth's
  service, not the reverse.
- `AuthModule`/`AuthController` now contain JWT-only concerns: login, register,
  refresh, logout, OAuth (which still issues JWT on callback per ADR-010), 2FA,
  magic links.
- Bug fix folded into the move: `session/logout` now actually has
  `@UseGuards(SessionGuard)` applied. Regression test
  (`session-auth.controller.spec.ts`) asserts the guard metadata is present on the
  method, so this can't silently regress again.

`express-session` middleware itself stays global in `main.ts` — it's still required
by Passport's OAuth strategies (state storage across the redirect), which live in
`AuthModule`. That's infrastructure-level, not module-owned, and is unaffected by
this split.

## Alternatives Considered

### Leave it as-is, just fix the guard bug
- Pros: smallest possible change
- Cons: doesn't address the root cause — two unrelated auth mechanisms in one
  controller is what made the bug easy to introduce and hard to spot in review
- Rejected: fixing the symptom without the structural cause invites the same class
  of bug next time someone touches this file

### Delete session-based auth entirely
- Pros: removes the most overengineered/least-used auth path; lowest total complexity
- Cons: it's a real, working feature with legitimate use cases (instant server-side
  revocation, XSS-resistant cookie-only auth for non-SPA clients, session-fixation
  defense) — see ADR-010's Context section
- Rejected: not this project's call to make unilaterally; kept, just isolated

### Move SessionGuard/SessionSerializer but keep routes in AuthController
- Pros: smaller diff
- Cons: still couples the controller to two state models (`req.user` vs
  `req.session`); doesn't fully solve the "one module, one concern" goal
- Rejected: half-measure — the controller-level mixing was as much the problem as
  the guard placement

## Consequences
- Module boundary now matches the rule: one module, one auth approach. `AuthModule`
  = JWT. `SessionAuthModule` = cookie session.
- `SessionLoginInput` is a separate DTO from `LoginInput` (same shape: email +
  password) rather than imported across modules — keeps the two modules free of
  cross-imports beyond the single `AuthService` dependency.
- ADR-010's claim that "session endpoints are guarded separately — `@Public()` is
  set on session routes" is now only true for `login` (which must be public to
  attempt a login). `logout` is `@UseGuards(SessionGuard)`, not `@Public()`. CLAUDE.md
  updated to reflect this.
- Any future session-only feature (e.g. "list active sessions") belongs in
  `SessionAuthModule`, not `AuthModule`.
