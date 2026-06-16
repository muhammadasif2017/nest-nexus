import { encryptTotpSecret, decryptTotpSecret } from './totp-crypto.util';

// 256-bit key as hex (32 bytes = 64 hex chars)
const TEST_KEY = 'a'.repeat(64);
const WRONG_KEY = 'b'.repeat(64);
const SECRET = 'JBSWY3DPEHPK3PXP'; // typical base32 TOTP secret

describe('totp-crypto.util', () => {
  // ── encryptTotpSecret ────────────────────────────────────────────────────────

  describe('encryptTotpSecret()', () => {
    it('output starts with enc: prefix', () => {
      const result = encryptTotpSecret(SECRET, TEST_KEY);
      expect(result.startsWith('enc:')).toBe(true);
    });

    it('output after prefix is valid base64', () => {
      const result = encryptTotpSecret(SECRET, TEST_KEY);
      const encoded = result.slice('enc:'.length);
      expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
      expect(Buffer.from(encoded, 'base64').length).toBeGreaterThan(0);
    });

    it('produces different ciphertext on each call (random IV)', () => {
      const first = encryptTotpSecret(SECRET, TEST_KEY);
      const second = encryptTotpSecret(SECRET, TEST_KEY);
      expect(first).not.toBe(second);
    });

    it('encoded payload is at least IV(12) + authTag(16) + 1 byte ciphertext', () => {
      const result = encryptTotpSecret(SECRET, TEST_KEY);
      const buf = Buffer.from(result.slice('enc:'.length), 'base64');
      expect(buf.length).toBeGreaterThanOrEqual(12 + 16 + 1);
    });
  });

  // ── decryptTotpSecret ────────────────────────────────────────────────────────

  describe('decryptTotpSecret()', () => {
    it('decrypts to original secret', () => {
      const encrypted = encryptTotpSecret(SECRET, TEST_KEY);
      expect(decryptTotpSecret(encrypted, TEST_KEY)).toBe(SECRET);
    });

    it('round-trips arbitrary secrets', () => {
      const secrets = ['ABC123', 'AAAA', 'JBSWY3DPEHPK3PXP', '12345678901234567890'];
      for (const s of secrets) {
        expect(decryptTotpSecret(encryptTotpSecret(s, TEST_KEY), TEST_KEY)).toBe(s);
      }
    });

    it('returns value as-is when no enc: prefix (legacy plaintext passthrough)', () => {
      expect(decryptTotpSecret('PLAINTEXTSECRET', TEST_KEY)).toBe('PLAINTEXTSECRET');
    });

    it('returns empty string as-is when no enc: prefix', () => {
      expect(decryptTotpSecret('', TEST_KEY)).toBe('');
    });

    it('throws when decrypting with wrong key (GCM auth tag mismatch)', () => {
      const encrypted = encryptTotpSecret(SECRET, TEST_KEY);
      expect(() => decryptTotpSecret(encrypted, WRONG_KEY)).toThrow();
    });

    it('does not return plaintext for wrong key — throws before exposing data', () => {
      const encrypted = encryptTotpSecret(SECRET, TEST_KEY);
      let result: string | undefined;
      try {
        result = decryptTotpSecret(encrypted, WRONG_KEY);
      } catch {
        result = undefined;
      }
      expect(result).toBeUndefined();
    });
  });
});
