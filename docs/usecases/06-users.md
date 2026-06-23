# Users — Profile & Admin (REST + GraphQL)

Set variables first:
```bash
BASE=http://localhost:3000
TOKEN="<access token from login>"
ADMIN_TOKEN="<access token from admin account>"
USER_ID="<target user id>"
```

---

## REST Endpoints

### 1. Get own profile — JWT payload

**GET** `/api/v1/auth/me`

```bash
curl -s $BASE/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** JWT payload (`sub`, `email`, `roles`, `iat`, `exp`) — not the full DB row.

---

## GraphQL Queries & Mutations

GraphQL endpoint: `POST http://localhost:3000/graphql`

For all authenticated queries, set header: `Authorization: Bearer $TOKEN`

**Postman GraphQL Setup:**
- Method: **POST** → `{{baseUrl}}/graphql`
- **Body** tab → select **GraphQL** (not raw). Postman fetches the schema automatically on first use.
- **Authorization** tab → **Bearer Token** → `{{accessToken}}` (inherited from collection for all GraphQL requests).
- In the GraphQL body editor, the left pane is the query, the right pane (Variables) is for `$variables`.
- Alternatively use **raw** → **JSON** with `{"query":"...","variables":{}}` if you prefer.

---

### 2. Get own profile — full user object

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"query { me { id email displayName roles isEmailVerified isActive avatarUrl lastLoginAt createdAt } }"}' | jq
```

**Expect:** Full `UserOutput` object. Confirm `password` is absent.

**Postman:** GraphQL body:
```graphql
query {
  me { id email displayName roles isEmailVerified isActive avatarUrl lastLoginAt createdAt }
}
```

---

### 3. Get public user by ID

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"query { user(id: \\\"$USER_ID\\\") { id email displayName roles } }\"}" | jq
```

**Expect:** `200` with user or `null` if not found (no `401` — this is a public query).

**Postman:** GraphQL body (no auth header needed):
```graphql
query {
  user(id: "<USER_ID>") { id email displayName roles }
}
```

**Verify:** `password`, `lastLoginIp`, `twoFactorSecret` not present in response.

---

### 4. Update own profile

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { updateProfile(input: { displayName: \"Alice Updated\" }) { id displayName updatedAt } }"}' | jq
```

**Expect:** Updated user object with new `displayName` and refreshed `updatedAt`.

**Postman:** GraphQL body:
```graphql
mutation {
  updateProfile(input: { displayName: "Alice Updated" }) { id displayName updatedAt }
}
```

**Verify:**
- Cache key `users:id:<id>` invalidated (next `query { user }` fetches fresh data)
- `user.updated` event emitted (check SSE stream if connected — see [08-notifications.md](08-notifications.md))

**Negative — update another user's profile:**
```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"mutation { updateProfile(input: { displayName: \\\"Hacked\\\" }) { id } }\"}" | jq
# updateProfile always targets the current user (from JWT sub) — cannot target others
```

---

### 5. List all users (admin only)

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"query":"query { users { id email displayName roles isActive } }"}' | jq
```

**Expect:** Array of all active users.

**Postman:** Use `{{adminToken}}` as the Bearer Token (set it as a collection variable after logging in with an admin account). GraphQL body:
```graphql
query {
  users { id email displayName roles isActive }
}
```

**Negative — non-admin token:**
```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"query { users { id email } }"}' | jq
# Expect GraphQL error with extensions.code: "FORBIDDEN"
```

---

### 6. Deactivate user (admin only)

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"query\":\"mutation { deactivateUser(id: \\\"$USER_ID\\\") { id isActive } }\"}" | jq
```

**Expect:** `{ id: "...", isActive: false }`

**Postman:** Bearer Token → `{{adminToken}}`. GraphQL body:
```graphql
mutation {
  deactivateUser(id: "<USER_ID>") { id isActive }
}
```

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
- `user.deactivated` event fires → SSE clients notified

---

### 7. GraphQL — unauthenticated access to protected query

```bash
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"query { me { id } }"}' | jq
# Expect GraphQL error with extensions.code: "UNAUTHENTICATED"
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
# Full introspection check
curl -s -X POST $BASE/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"query { me { id email displayName roles isEmailVerified isActive avatarUrl lastLoginAt createdAt updatedAt } }"}' | jq 'keys'
# None of the sensitive fields above should appear even if added to the query
```
