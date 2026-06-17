import crypto from 'crypto';
import { sha256Hex } from './hash.util';

describe('sha256Hex()', () => {
  it('returns the known SHA-256 hex digest for a given input', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('matches crypto.createHash output for arbitrary input', () => {
    const input = 'user-123:ABCD1234';
    const expected = crypto.createHash('sha256').update(input).digest('hex');
    expect(sha256Hex(input)).toBe(expected);
  });

  it('returns a 64-character lowercase hex string', () => {
    const result = sha256Hex('any-token-value');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input always produces the same hash', () => {
    expect(sha256Hex('repeatable')).toBe(sha256Hex('repeatable'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('hashes an empty string without throwing', () => {
    expect(() => sha256Hex('')).not.toThrow();
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });
});
