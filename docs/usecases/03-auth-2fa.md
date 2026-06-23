# Auth — Two-Factor Authentication (TOTP + Backup Codes)

**Prerequisites:** Logged in with a valid `$TOKEN`. Install an authenticator app
(Google Authenticator, Authy, 1Password) to scan QR codes.

---

## 1. Setup — generate TOTP secret and QR code

**POST** `/api/v1/auth/2fa/setup`

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/setup \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:**
```json
{
  "secret": "BASE32SECRET...",
  "qrCode": "data:image/png;base64,..."
}
```

**Verify:**
- `secret` is a Base32 string
- `qrCode` is a valid PNG data URL — paste it into a browser `<img>` tag to see the QR code
- 2FA is NOT yet active (calling `/api/v1/auth/2fa/disable` at this point should fail)
- Secret is stored encrypted in DB (`twoFactorSecret` starts with `enc:`)

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/2fa/setup`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- No body. Send and copy the `secret` value from the response — you'll need it to configure your authenticator app.
- To view the QR code: copy the `qrCode` data URL, open a new browser tab, paste it in the address bar.

```sql
SELECT "twoFactorSecret", "isTwoFactorEnabled" FROM "User" WHERE email = 'alice@example.com';
-- twoFactorSecret should start with 'enc:'
-- isTwoFactorEnabled should be false
```

---

## 2. Enable — confirm TOTP and activate

**POST** `/api/v1/auth/2fa/enable`

Scan the QR code from step 1 in your authenticator app, then:

```bash
TOTP_CODE="123456"   # 6-digit code from your authenticator app
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/enable \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TOTP_CODE\"}" | jq
```

**Expect:**
```json
{
  "backupCodes": ["ABCD-1234", "EFGH-5678", ...]  // 10 codes
}
```

**Verify:**
- Exactly 10 backup codes in `XXXX-XXXX` format
- `isTwoFactorEnabled = true` in DB
- Store backup codes somewhere safe — shown only once

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/2fa/enable`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- **Body** tab → **raw** → **JSON**: `{"code":"123456"}` (replace with live code from authenticator app)
- Save the `backupCodes` array from the response — not shown again.

**Negative — wrong TOTP code:**
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/enable \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"000000"}' | jq
# Expect 401
```

---

## 3. Login with 2FA — pending token flow

**Step A:** Login returns a pending-scope token (NOT a full session token):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}' | jq
# Response: { accessToken: "...", isTwoFactorPending: true }
# This token has scope: 'two_factor_pending', expires in 5 min
```

**Step B:** Verify TOTP to upgrade to full token:

```bash
PENDING_TOKEN="<accessToken from step A>"
TOTP_CODE="123456"
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/verify \
  -H "Authorization: Bearer $PENDING_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TOTP_CODE\"}" | jq
# Response: full { accessToken, refreshToken, user }
```

**Verify:**
- Pending token rejected on all other endpoints:
```bash
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $PENDING_TOKEN" | jq
# Expect 403 "Two-factor authentication required."
```

**Postman (Step A — login):**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/login`
- **Body**: `{"email":"alice@example.com","password":"StrongPass1!"}`
- Response includes `isTwoFactorPending: true` and a short-lived `accessToken`.
- In the **Tests** tab for this specific request, override the shared capture script to save as `pendingToken`:
  ```javascript
  const data = pm.response.json();
  if (data?.accessToken) pm.collectionVars.set('pendingToken', data.accessToken);
  ```

**Postman (Step B — verify TOTP):**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/2fa/verify`
- **Authorization** tab → **Bearer Token** → `{{pendingToken}}`
- **Body** tab → **raw** → **JSON**: `{"code":"123456"}`
- Response returns the full token — the shared collection script saves it as `{{accessToken}}`.

---

## 4. Login with 2FA — use backup code

```bash
PENDING_TOKEN="<from login>"
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/verify \
  -H "Authorization: Bearer $PENDING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"ABCD-1234"}' | jq
# Expect: full token (same as TOTP verify)
```

**Verify:**
- Backup code `ABCD-1234` is now consumed — using it again returns `401`
- Remaining 9 backup codes still valid

**Postman:**
- Same as Step B above, but body uses a backup code: `{"code":"ABCD-1234"}`

---

## 5. Disable 2FA

**POST** `/api/v1/auth/2fa/disable`

```bash
TOTP_CODE="123456"
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/disable \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TOTP_CODE\"}" | jq
```

**Verify:**
- `isTwoFactorEnabled = false` in DB
- Subsequent login returns a full token directly (no pending step)
- Old backup codes are wiped

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/2fa/disable`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- **Body** tab → **raw** → **JSON**: `{"code":"123456"}`

**Using a backup code to disable:**
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/2fa/disable \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"EFGH-5678"}' | jq
```

---

## 6. Pending token cannot call setup/enable/disable

```bash
# All of these must return 403 with a pending token
for ENDPOINT in setup enable disable; do
  curl -s -o /dev/null -w "$ENDPOINT: %{http_code}\n" \
    -X POST http://localhost:3000/api/v1/auth/2fa/$ENDPOINT \
    -H "Authorization: Bearer $PENDING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"code":"000000"}'
done
```

**Expect:** All return `403`.
