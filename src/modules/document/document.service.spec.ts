import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { AuthorizationService, AuthSubject } from '../authorization/authorization.service';
import { RelationService, Relation } from '../authorization/rebac/relation.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const user = (sub = 'u1', roles: string[] = ['user']): AuthSubject => ({ sub, roles });
const row = (overrides = {}) => ({
  id: 'd1',
  title: 't',
  body: 'b',
  visibility: 'private',
  ownerId: 'u1',
  createdAt: new Date(),
  ...overrides,
});

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: {
    document: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    user: { findUnique: jest.Mock };
    relationTuple: { deleteMany: jest.Mock };
  };
  let authz: {
    filterReadableDocuments: jest.Mock;
    can: jest.Mock;
    isSuperAdmin: jest.Mock;
  };
  let relation: { grant: jest.Mock; revoke: jest.Mock };

  beforeEach(() => {
    prisma = {
      document: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      relationTuple: { deleteMany: jest.fn() },
    };
    authz = {
      filterReadableDocuments: jest.fn(),
      can: jest.fn(),
      isSuperAdmin: jest.fn().mockReturnValue(false),
    };
    relation = { grant: jest.fn(), revoke: jest.fn() };
    service = new DocumentService(
      prisma as unknown as PrismaService,
      authz as unknown as AuthorizationService,
      relation as unknown as RelationService,
    );
  });

  describe('findAll — paginated bulk filter', () => {
    it('passes skip/take through and returns the readable subset', async () => {
      const docs = [row({ id: 'a' }), row({ id: 'b' })];
      prisma.document.findMany.mockResolvedValue(docs);
      authz.filterReadableDocuments.mockResolvedValue([docs[0]]);

      const result = await service.findAll(user(), { skip: 10, take: 5 });

      expect(prisma.document.findMany).toHaveBeenCalledWith({
        skip: 10,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(authz.filterReadableDocuments).toHaveBeenCalledWith(user(), docs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });
  });

  describe('findOne — no-enumeration', () => {
    it('throws NotFound (not Forbidden) when the read is denied', async () => {
      prisma.document.findUnique.mockResolvedValue(row({ ownerId: 'someone-else' }));
      authz.can.mockResolvedValue(false);
      await expect(service.findOne(user('stranger'), 'd1')).rejects.toThrow(NotFoundException);
    });

    it('returns the document when the read is allowed', async () => {
      prisma.document.findUnique.mockResolvedValue(row());
      authz.can.mockResolvedValue(true);
      const result = await service.findOne(user(), 'd1');
      expect(result.id).toBe('d1');
    });
  });

  describe('update — visibility is owner-only', () => {
    it('rejects a non-owner changing visibility', async () => {
      prisma.document.findUnique.mockResolvedValue(row({ ownerId: 'owner' }));
      await expect(service.update(user('editor'), 'd1', { visibility: 'public' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

    it('allows the owner to change visibility', async () => {
      prisma.document.findUnique.mockResolvedValue(row({ ownerId: 'u1' }));
      prisma.document.update.mockResolvedValue(row({ visibility: 'public' }));
      await service.update(user('u1'), 'd1', { visibility: 'public' });
      expect(prisma.document.update).toHaveBeenCalled();
    });

    it('allows super_admin to change visibility without an ownership lookup', async () => {
      authz.isSuperAdmin.mockReturnValue(true);
      prisma.document.update.mockResolvedValue(row({ visibility: 'public' }));
      await service.update(user('admin', ['super_admin']), 'd1', { visibility: 'public' });
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
      expect(prisma.document.update).toHaveBeenCalled();
    });

    it('does not check ownership when visibility is not being changed', async () => {
      prisma.document.update.mockResolvedValue(row({ title: 'new' }));
      await service.update(user('editor'), 'd1', { title: 'new' });
      expect(prisma.document.findUnique).not.toHaveBeenCalled();
      expect(prisma.document.update).toHaveBeenCalled();
    });
  });

  describe('share / unshare', () => {
    it('rejects granting the owner relation via share', async () => {
      await expect(
        service.share('d1', { subjectId: 'u2', relation: Relation.OWNER }),
      ).rejects.toThrow(BadRequestException);
      expect(relation.grant).not.toHaveBeenCalled();
    });

    it('rejects sharing with a non-existent user', async () => {
      prisma.document.findUnique.mockResolvedValue(row());
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.share('d1', { subjectId: 'ghost', relation: Relation.VIEWER }),
      ).rejects.toThrow(BadRequestException);
      expect(relation.grant).not.toHaveBeenCalled();
    });

    it('grants a viewer relation to a real user', async () => {
      prisma.document.findUnique.mockResolvedValue(row());
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      await service.share('d1', { subjectId: 'u2', relation: Relation.VIEWER });
      expect(relation.grant).toHaveBeenCalledWith('u2', Relation.VIEWER, 'document', 'd1');
    });

    it('rejects revoking the owner relation via unshare', async () => {
      await expect(
        service.unshare('d1', { subjectId: 'u2', relation: Relation.OWNER }),
      ).rejects.toThrow(BadRequestException);
      expect(relation.revoke).not.toHaveBeenCalled();
    });
  });
});
