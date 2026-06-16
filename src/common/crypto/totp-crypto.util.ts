import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENC_PREFIX = 'enc:';

/**
 * Encrypts a TOTP secret with AES-256-GCM.
 * Output format: `enc:<base64(iv[12] || authTag[16] || ciphertext)>`
 * The prefix distinguishes encrypted values from legacy plaintext in the DB.
 */
export function encryptTotpSecret(secret: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts a TOTP secret previously encrypted with encryptTotpSecret.
 * Falls back to returning the value as-is if it lacks the `enc:` prefix
 * so that legacy plaintext secrets continue to work until users re-enroll.
 */
export function decryptTotpSecret(stored: string, keyHex: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
