import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RelationService, Relation } from './relation.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('RelationService', () => {
  let service: RelationService;
  let prisma: {
    relationTuple: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let emitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      relationTuple: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    emitter = { emit: jest.fn() };
    service = new RelationService(
      prisma as unknown as PrismaService,
      emitter as unknown as EventEmitter2,
    );
  });

  describe('grant', () => {
    it('upserts the tuple and emits authz.relation.changed', async () => {
      await service.grant('u1', Relation.VIEWER, 'document', 'd1');
      expect(prisma.relationTuple.upsert).toHaveBeenCalledTimes(1);
      expect(emitter.emit).toHaveBeenCalledWith('authz.relation.changed', {
        subjectId: 'u1',
        objectType: 'document',
        objectId: 'd1',
      });
    });
  });

  describe('revoke', () => {
    it('deletes and emits when a tuple existed', async () => {
      prisma.relationTuple.deleteMany.mockResolvedValue({ count: 1 });
      await service.revoke('u1', Relation.VIEWER, 'document', 'd1');
      expect(emitter.emit).toHaveBeenCalledTimes(1);
    });

    it('throws NotFound and does not emit when nothing deleted', async () => {
      prisma.relationTuple.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.revoke('u1', Relation.VIEWER, 'document', 'd1')).rejects.toThrow(
        NotFoundException,
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('returns true when a satisfying tuple exists', async () => {
      prisma.relationTuple.findFirst.mockResolvedValue({ id: 't1' });
      expect(await service.check('u1', Relation.VIEWER, 'document', 'd1')).toBe(true);
    });

    it('returns false when no tuple exists', async () => {
      prisma.relationTuple.findFirst.mockResolvedValue(null);
      expect(await service.check('u1', Relation.OWNER, 'document', 'd1')).toBe(false);
    });

    it('queries stronger relations as grantors (implication)', async () => {
      prisma.relationTuple.findFirst.mockResolvedValue(null);
      await service.check('u1', Relation.VIEWER, 'document', 'd1');
      const where = prisma.relationTuple.findFirst.mock.calls[0][0].where;
      // viewer can be granted by owner, editor, or viewer
      expect(where.relation.in).toEqual(
        expect.arrayContaining([Relation.OWNER, Relation.EDITOR, Relation.VIEWER]),
      );
    });

    it('owner requirement is satisfied only by owner', async () => {
      prisma.relationTuple.findFirst.mockResolvedValue(null);
      await service.check('u1', Relation.OWNER, 'document', 'd1');
      const where = prisma.relationTuple.findFirst.mock.calls[0][0].where;
      expect(where.relation.in).toEqual([Relation.OWNER]);
    });
  });
});
