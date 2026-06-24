import { evaluatePolicy, PolicyContext } from './policies';

const ctx = (userId: string, ownerId: string, visibility: string): PolicyContext => ({
  user: { sub: userId, roles: [] },
  resource: { ownerId, visibility },
});

describe('ABAC policies', () => {
  describe('document.read', () => {
    it('allows anyone to read a public document', () => {
      expect(evaluatePolicy('document.read', ctx('u2', 'u1', 'public'))).toBe(true);
    });

    it('allows any authenticated user to read an internal document', () => {
      expect(evaluatePolicy('document.read', ctx('u2', 'u1', 'internal'))).toBe(true);
    });

    it('allows the owner to read a private document', () => {
      expect(evaluatePolicy('document.read', ctx('u1', 'u1', 'private'))).toBe(true);
    });

    it('denies a non-owner reading a private document', () => {
      expect(evaluatePolicy('document.read', ctx('u2', 'u1', 'private'))).toBe(false);
    });
  });

  it('denies an unknown policy name (deny-by-default)', () => {
    expect(evaluatePolicy('document.nonexistent', ctx('u1', 'u1', 'public'))).toBe(false);
  });
});
