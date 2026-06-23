# Users — Profile & Admin (REST)

Set variables first:
```bash
BASE=http://localhost:3000
TOKEN="<access token from login>"
ADMIN_TOKEN="<access token from admin account>"
USER_ID="<target user id>"
```

All user operations are REST under `/api/v1`. For authenticated requests, set
header: `Authorization: Bearer $TOKEN`.

---

### 1. Get own profile — JWT payload

**GET** `/api/v1/auth/me`

```bash
curl -s $BASE/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** JWT payload (`sub`, `email`, `roles`, `iat`, `exp`) — not the full DB row.

---

### 2. Get own profile — full user object

**GET** `/api/v1/users/me`

```bash
curl -s $BASE/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** Full `UserOutput` object. Confirm `password` is absent.

---

### 3. Get user by ID (authenticated)

**GET** `/api/v1/users/:id`

```bash
curl -s $BASE/api/v1/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `200` with the user, or `null` if not found. Without a token: `401`
(not public — avoids email/role disclosure by ID enumeration).

**Verify:** `password`, `lastLoginIp`, `twoFactorSecret` not present in response.

---

### 4. Update own profile

**PATCH** `/api/v1/users/me`

```bash
curl -s -X PATCH $BASE/api/v1/users/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"displayName":"Alice Updated"}' | jq
```

**Expect:** Updated user object with new `displayName` and refreshed `updatedAt`.

**Verify:**
- Cache key `users:id:<id>` invalidated (next `GET /users/:id` fetches fresh data)
- `user.updated` event emitted (drives cache invalidation — see [ADR-011](../decisions/ADR-011-event-driven-cache-invalidation.md))

**Note:** `updateProfile` always targets the current user (from JWT `sub`) — it
cannot target another user.

---

### 5. List all users (admin only)

**GET** `/api/v1/users`

```bash
curl -s $BASE/api/v1/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Expect:** Array of all active users.

**Negative — non-admin token:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/users \
  -H "Authorization: Bearer $TOKEN"
# Expect 403 (errorCode "FORBIDDEN")
```

---

### 6. Deactivate user (admin only)

**DELETE** `/api/v1/users/:id` (soft delete — sets `isActive=false`)

```bash
curl -s -X DELETE $BASE/api/v1/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Expect:** `{ id: "...", isActive: false }`

**Verify:**
- Deactivated user can no longer authenticate:
```bash
curl -s -X POST $BASE/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"deactivated@example.com","password":"StrongPass1!"}' | jq
# Expect 403 "Your account has been deactivated."
```
- Within 30s, existing JWT for deactivated user is rejected:
```bash
curl -s $BASE/api/v1/auth/me -H "Authorization: Bearer $DEACTIVATED_USER_TOKEN" | jq
# Expect 401 (after in-process cache expires or is invalidated by event)
```
- `user.deactivated` event fires → `JwtStrategy`/`SessionGuard` invalidate their in-process active-status caches

---

### 7. Unauthenticated access to a protected route

```bash
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/users/me
# Expect 401 (errorCode "UNAUTHENTICATED")
```

---

### 8. Serialization — sensitive fields never exposed

For every response type, verify these fields are absent:
- `password`
- `twoFactorSecret`
- `twoFactorBackupCodes`
- `magicLinkTokenHash`
- `magicLinkExpiresAt`
- `emailVerificationToken`
- `passwordResetToken`
- `lastLoginIp`

```bash
curl -s $BASE/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" | jq 'keys'
# None of the sensitive fields above should appear — UserOutput @Expose() allow-lists fields
```
