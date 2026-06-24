import { AuthorizationService, AuthSubject, DocumentResource } from './authorization.service';
import { RelationService, Relation } from './rebac/relation.service';
import { Role } from '../../common/enums/role.enum';
import { Permission } from '../../common/enums/permission.enum';

const subject = (roles: string[], sub = 'u1'): AuthSubject => ({ sub, roles });

const doc = (overrides: Partial<DocumentResource> = {}): DocumentResource => ({
  id: 'd1',
  ownerId: 'owner',
  visibility: 'private',
  ...overrides,
});

describe('AuthorizationService', () => {
  let authz: AuthorizationService;
  let relation: { check: jest.Mock; objectIdsFor: jest.Mock };

  beforeEach(() => {
    relation = {
      check: jest.fn().mockResolvedValue(false),
      objectIdsFor: jest.fn().mockResolvedValue([]),
    };
    authz = new AuthorizationService(relation as unknown as RelationService);
  });

  describe('isSuperAdmin', () => {
    it('is true for super_admin', () => {
      expect(authz.isSuperAdmin(subject([Role.SUPER_ADMIN]))).toBe(true);
    });

    it('is false for other roles', () => {
      expect(authz.isSuperAdmin(subject([Role.ADMIN]))).toBe(false);
    });

    it('is false for null/undefined user', () => {
      expect(authz.isSuperAdmin(null)).toBe(false);
      expect(authz.isSuperAdmin(undefined)).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('grants a permission mapped to the user role', () => {
      expect(authz.hasPermission(subject([Role.USER]), Permission.DOCUMENT_WRITE)).toBe(true);
    });

    it('denies a permission not mapped to the user role', () => {
      expect(authz.hasPermission(subject([Role.USER]), Permission.DOCUMENT_READ_ANY)).toBe(false);
    });

    it('grants read:any to moderator', () => {
      expect(authz.hasPermission(subject([Role.MODERATOR]), Permission.DOCUMENT_READ_ANY)).toBe(
        true,
      );
    });

    it('super_admin bypass grants any permission', () => {
      expect(authz.hasPermission(subject([Role.SUPER_ADMIN]), Permission.DOCUMENT_READ_ANY)).toBe(
        true,
      );
    });

    it('unions permissions across multiple roles', () => {
      expect(
        authz.hasPermission(subject([Role.USER, Role.MODERATOR]), Permission.DOCUMENT_READ_ANY),
      ).toBe(true);
    });

    it('denies when user is null or has no roles', () => {
      expect(authz.hasPermission(null, Permission.DOCUMENT_READ)).toBe(false);
      expect(authz.hasPermission({ sub: 'u1' } as AuthSubject, Permission.DOCUMENT_READ)).toBe(
        false,
      );
    });

    it('ignores unknown role strings', () => {
      expect(authz.hasPermission(subject(['ghost']), Permission.DOCUMENT_READ)).toBe(false);
    });
  });

  describe('can() — deny-by-default + composition', () => {
    it('denies a null user', async () => {
      expect(await authz.can(null, Permission.DOCUMENT_READ, doc())).toBe(false);
    });

    it('super_admin is allowed for any action without further checks', async () => {
      expect(await authz.can(subject([Role.SUPER_ADMIN]), Permission.DOCUMENT_DELETE, doc())).toBe(
        true,
      );
      expect(relation.check).not.toHaveBeenCalled();
    });

    it('denies read when the role lacks the read scope (RBAC gate)', async () => {
      // unknown role → no scopes
      expect(await authz.can(subject(['ghost']), Permission.DOCUMENT_READ, doc())).toBe(false);
    });

    describe('read', () => {
      it('allows via read:any scope (moderator) without ABAC/ReBAC', async () => {
        expect(await authz.can(subject([Role.MODERATOR]), Permission.DOCUMENT_READ, doc())).toBe(
          true,
        );
        expect(relation.check).not.toHaveBeenCalled();
      });

      it('allows via ABAC public visibility', async () => {
        expect(
          await authz.can(
            subject([Role.USER]),
            Permission.DOCUMENT_READ,
            doc({ visibility: 'public' }),
          ),
        ).toBe(true);
      });

      it('allows non-owner of a private doc via ReBAC viewer tuple', async () => {
        relation.check.mockResolvedValue(true);
        expect(
          await authz.can(subject([Role.USER], 'stranger'), Permission.DOCUMENT_READ, doc()),
        ).toBe(true);
        expect(relation.check).toHaveBeenCalledWith('stranger', Relation.VIEWER, 'document', 'd1');
      });

      it('denies private doc with no relation and no qualifying attribute', async () => {
        expect(
          await authz.can(subject([Role.USER], 'stranger'), Permission.DOCUMENT_READ, doc()),
        ).toBe(false);
      });
    });

    describe('write', () => {
      it('allows the owner', async () => {
        expect(
          await authz.can(subject([Role.USER], 'owner'), Permission.DOCUMENT_WRITE, doc()),
        ).toBe(true);
        expect(relation.check).not.toHaveBeenCalled();
      });

      it('allows a non-owner editor via ReBAC', async () => {
        relation.check.mockResolvedValue(true);
        expect(
          await authz.can(subject([Role.USER], 'stranger'), Permission.DOCUMENT_WRITE, doc()),
        ).toBe(true);
        expect(relation.check).toHaveBeenCalledWith('stranger', Relation.EDITOR, 'document', 'd1');
      });

      it('denies a non-owner with no editor relation', async () => {
        expect(
          await authz.can(subject([Role.USER], 'stranger'), Permission.DOCUMENT_WRITE, doc()),
        ).toBe(false);
      });
    });

    describe('delete', () => {
      it('requires the owner relation for a non-owner', async () => {
        relation.check.mockResolvedValue(true);
        expect(
          await authz.can(subject([Role.USER], 'stranger'), Permission.DOCUMENT_DELETE, doc()),
        ).toBe(true);
        expect(relation.check).toHaveBeenCalledWith('stranger', Relation.OWNER, 'document', 'd1');
      });
    });
  });

  describe('readableDocumentWhere() — DB-level read filter', () => {
    it('returns null for a null user', async () => {
      expect(await authz.readableDocumentWhere(null)).toBeNull();
      expect(relation.objectIdsFor).not.toHaveBeenCalled();
    });

    it('returns null when the role lacks the read scope', async () => {
      expect(await authz.readableDocumentWhere(subject(['ghost']))).toBeNull();
    });

    it('returns {} (every row) for super_admin without a relation query', async () => {
      expect(await authz.readableDocumentWhere(subject([Role.SUPER_ADMIN]))).toEqual({});
      expect(relation.objectIdsFor).not.toHaveBeenCalled();
    });

    it('returns {} (every row) for a read:any holder without a relation query', async () => {
      expect(await authz.readableDocumentWhere(subject([Role.MODERATOR]))).toEqual({});
      expect(relation.objectIdsFor).not.toHaveBeenCalled();
    });

    it('builds an OR of ABAC visibility + ownership + viewer-relation ids', async () => {
      relation.objectIdsFor.mockResolvedValue(['b']);
      const where = await authz.readableDocumentWhere(subject([Role.USER], 'stranger'));
      expect(where).toEqual({
        OR: [
          { visibility: { in: ['public', 'internal'] } },
          { ownerId: 'stranger' },
          { id: { in: ['b'] } },
        ],
      });
      expect(relation.objectIdsFor).toHaveBeenCalledWith('stranger', Relation.VIEWER, 'document');
    });

    it('omits the id clause when the subject holds no viewer tuples', async () => {
      relation.objectIdsFor.mockResolvedValue([]);
      const where = await authz.readableDocumentWhere(subject([Role.USER], 'stranger'));
      expect(where).toEqual({
        OR: [{ visibility: { in: ['public', 'internal'] } }, { ownerId: 'stranger' }],
      });
    });
  });
});
