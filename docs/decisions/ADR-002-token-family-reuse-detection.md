# ADR-002: Token Family Model for Refresh Token Reuse Detection

## Status
Accepted

## Date
2026-06-15

## Context
Refresh token rotation (issue a new token on every use, invalidate the old one)
prevents stolen tokens from granting indefinite access. But rotation alone has a
gap: if an attacker steals a token and uses it first, the legitimate user's next
refresh will fail with a generic "token not found" error — we can't distinguish
"token expired normally" from "token was stolen and rotated out by an attacker."

We need a mechanism to detect replay attacks and respond proportionally.

## Decision
Implement token families: every token carries a `jti` (unique per token) and a
`family` ID (shared across a rotation chain). When a token is presented:

1. If the token hash matches a non-revoked entry → valid rotation, mark old as
   revoked, issue new token in the same family.
2. If the token's family exists but no hash matches → the token was already
   rotated out. This is reuse of a consumed token — definitive evidence of
   theft. **Revoke the entire family immediately**, forcing full re-login.
3. If neither the family nor hash matches → expired or fabricated token,
   standard rejection.

## Alternatives Considered

### Single-token invalidation on reuse
- Pros: Simpler; only revokes the specific token presented
- Cons: An attacker who rotated the token first keeps a valid token in hand;
  the legitimate user's failure doesn't trigger any escalation; theft goes
  undetected until TTL expiry
- Rejected: Doesn't limit attacker access after the first successful rotation

### Sliding revocation window (revoke tokens issued more than N seconds ago)
- Pros: Bounds the reuse window without tracking families
- Cons: Race conditions with legitimate concurrent refreshes (mobile + web);
  legitimate tokens revoked if refresh is slow; doesn't detect theft, just
  limits damage
- Rejected: False positives for normal usage; still doesn't detect the attack

### Version counter on user document (increment on every rotation, reject stale)
- Pros: Single integer, no family tracking overhead
- Cons: First-use-wins: simultaneous valid refreshes from two devices would
  invalidate each other; no way to scope revocation to a single compromised
  device session
- Rejected: Multi-device users hit false revocations under normal conditions

## Consequences
- Attackers who steal and use a refresh token trigger full family revocation
  the moment the legitimate user next attempts to refresh — limiting the attack
  window to one rotation cycle (at most 7 days, in practice much shorter).
- The family ID is embedded in the JWT payload, so no extra DB lookup is needed
  to find the correct family during validation.
- Multiple device sessions each get their own family, so compromising one device
  does not revoke sessions on other devices (unless the user explicitly logs out all).
- The error message on reuse is intentionally generic to avoid leaking whether
  the token was valid-but-consumed vs. never-valid.
