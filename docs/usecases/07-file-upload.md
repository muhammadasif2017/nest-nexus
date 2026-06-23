# File Upload

**Prerequisites:**
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` set in `.env`
- Logged in with a valid `$TOKEN`

Max file size: 20 MB. Avatar max: any size (resized to 256×256 WebP server-side).

---

## 1. Upload avatar

**POST** `/api/v1/upload/avatar`  
Multipart form-data, field name `file`.

```bash
curl -s -X POST http://localhost:3000/api/v1/upload/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.jpg" | jq
```

**Expect:**
```json
{
  "url": "https://your-bucket.s3.amazonaws.com/avatars/<userId>/avatar.webp",
  "key": "avatars/<userId>/avatar.webp"
}
```

**Verify:**
- URL is accessible in a browser (public S3 object)
- Image is exactly 256×256 pixels
- Format is WebP regardless of upload format (jpg/png/gif/etc.)
- File scanned for viruses before storage (ClamAV integration — check logs for scan result)

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/upload/avatar`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- **Body** tab → **form-data** → add a row: Key = `file`, hover the key field and switch type from **Text** to **File**, then select a `.jpg` or `.png` file from disk.
- Send. Response contains `url` and `key`.

**Negative — no file:**
```bash
curl -s -X POST http://localhost:3000/api/v1/upload/avatar \
  -H "Authorization: Bearer $TOKEN" | jq
# Expect 400 "No file provided"
```

**Negative — non-image file:**
```bash
curl -s -X POST http://localhost:3000/api/v1/upload/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/document.pdf" | jq
# Expect 400 "Only image files are allowed"
```

---

## 2. Upload generic file

**POST** `/api/v1/upload/file`  
Multipart form-data, field name `file`.

```bash
curl -s -X POST http://localhost:3000/api/v1/upload/file \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/document.pdf" | jq
```

**Expect:**
```json
{
  "url": "https://your-bucket.s3.amazonaws.com/uploads/<userId>/<filename>",
  "key": "uploads/<userId>/<filename>"
}
```

**Verify:**
- `key` starts with `uploads/<userId>/` — ownership prefix enforced
- File accessible at `url`

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/upload/file`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- **Body** tab → **form-data** → Key = `file` (type: **File**) → select any file from disk.
- Copy the `key` from the response — needed for the delete scenario below.

**Negative — file too large (>20 MB):**
```bash
# Generate a 21 MB test file
dd if=/dev/zero bs=1M count=21 of=/tmp/bigfile.bin 2>/dev/null
curl -s -X POST http://localhost:3000/api/v1/upload/file \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/bigfile.bin" | jq
# Expect 413 "File too large"
```

---

## 3. Delete file

**DELETE** `/api/v1/upload/:key(*)`

```bash
FILE_KEY="uploads/<userId>/document.pdf"
curl -s -X DELETE "http://localhost:3000/api/v1/upload/$FILE_KEY" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `200 { message: "File deleted." }`

**Postman:**
- Method: **DELETE** → `{{baseUrl}}/api/v1/upload/uploads/<userId>/document.pdf`
- Replace the path segment with the `key` returned from the upload step.
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- No body.

**Verify:** URL no longer accessible (S3 returns 403/404).

**Negative — delete another user's file:**
```bash
# Key belongs to a different userId
curl -s -X DELETE "http://localhost:3000/api/v1/upload/uploads/other-user-id/file.pdf" \
  -H "Authorization: Bearer $TOKEN" | jq
# Expect 403 "You do not have permission to delete this file."
```

**Negative — delete non-existent file:**
```bash
curl -s -X DELETE "http://localhost:3000/api/v1/upload/uploads/<userId>/nonexistent.pdf" \
  -H "Authorization: Bearer $TOKEN" | jq
# Expect 404
```

---

## 4. Unauthenticated upload attempt

```bash
curl -s -X POST http://localhost:3000/api/v1/upload/avatar \
  -F "file=@/path/to/photo.jpg" | jq
# Expect 401
```
