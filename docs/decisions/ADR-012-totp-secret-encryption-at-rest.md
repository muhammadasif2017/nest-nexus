# ADR-012: Encrypt TOTP Secrets at Rest with AES-256-GCM

## Status
Accepted

## Date
2026-06-16

## Context
TOTP-based 2FA (RFC 6238) relies on a shared secret stored on both the
authenticator app and the server. Prior to this decision, `twoFactorSecret`
was stored as plaintext in the `User` table.

A read-only database breach (e.g., via SQL injection, backup leak, or
compromised replica) would expose every enrolled user's TOTP secret
permanently. Unlike a stolen session token — which expires — a TOTP secret
has no TTL: an attacker who obtains it can generate valid 2FA codes
indefinitely, completely bypassing the second factor.

This is categorically worse than a password breach because:
- Passwords can be changed; re-enrolling 2FA requires the user to notice
  and act on a breach they may not know about.
- bcrypt-hashed passwords have a cost factor that limits brute-force;
  TOTP secrets are stored verbatim and immediately usable.

## Decision
Encrypt `twoFactorSecret` at rest using AES-256-GCM before writing to the
database. The encryption key (`TOTP_ENCRYPTION_KEY`) is a 32-byte value
stored in the environment, never in the database.

**Implementation:**
- Algorithm: AES-256-GCM — authenticated encryption; detects tampering
  without a separate HMAC.
- IV: 12 bytes, randomly generated per encryption (GCM recommended IV size).
- Stored format: `enc:<base64(iv[12] || authTag[16] || ciphertext)>`
- The `enc:` prefix distinguishes encrypted values from legacy plaintext,
  enabling backward-compatible reads during migration.
- Encryption/decryption lives in `src/common/crypto/totp-crypto.util.ts`
  using Node.js built-in `node:crypto` — no new runtime dependency.

**Key management:**
- `TOTP_ENCRYPTION_KEY` is validated at startup (Zod schema); the app
  refuses to start if it is absent or malformed.
- The key must be rotated out-of-band (forces all users to re-enroll);
  there is no online key rotation path by design — adding one creates
  more attack surface than it saves.

## Alternatives Considered

### Store TOTP secrets hashed (like passwords)
Rejected. TOTP verification requires reconstructing the original secret to
run the HMAC-SHA1/SHA256 algorithm. A one-way hash makes verification
impossible.

### Column-level encryption in the database (pgcrypto)
- Pros: transparent to the application layer.
- Cons: the decryption key must be accessible to the DB process; a DB
  credential leak often includes pgcrypto key access. Application-level
  encryption with an out-of-band key provides stronger separation.
- Rejected in favour of application-layer encryption.

### Vault / KMS (e.g., HashiCorp Vault, AWS KMS)
- Pros: hardware-backed key storage, audit log, automatic rotation.
- Cons: significant operational overhead for a boilerplate project;
  adds a hard external dependency.
- Deferred: the `encryptTotpSecret` / `decryptTotpSecret` interface can be
  swapped to a KMS-backed implementation without changing call sites.

### Leave plaintext (status quo)
Rejected. A TOTP secret exposed via DB breach permanently invalidates the
second factor for every affected user, with no expiry and no forced rotation.

## Consequences

- A database read-only breach no longer exposes usable TOTP secrets; the
  attacker also needs `TOTP_ENCRYPTION_KEY` from the environment.
- `TOTP_ENCRYPTION_KEY` becomes a root secret — loss or corruption forces
  full 2FA re-enrollment for all users. Back it up with the same rigour as
  `JWT_SECRET`.
- Existing enrolled users have plaintext secrets in the DB. The
  `decryptTotpSecret` fallback keeps them working, but they remain at risk
  until re-enrolled. Operators should run the migration query below and
  notify affected users:

  ```sql
  UPDATE "User"
  SET "twoFactorSecret" = NULL,
      "isTwoFactorEnabled" = false,
      "twoFactorBackupCodes" = '{}'
  WHERE "twoFactorSecret" IS NOT NULL
    AND "twoFactorSecret" NOT LIKE 'enc:%';
  ```

- The plaintext fallback path in `decryptTotpSecret` should be removed once
  all rows are migrated, to eliminate the bypass surface.
