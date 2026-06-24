import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';

// ReBAC relations on a document, strongest first.
export enum Relation {
  OWNER = 'owner',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

// Relation implication resolved in code (not stored as tuples): a stronger
// relation satisfies every weaker requirement. owner ⇒ editor ⇒ viewer.
const RELATION_IMPLIES: Record<Relation, readonly Relation[]> = {
  [Relation.OWNER]: [Relation.OWNER, Relation.EDITOR, Relation.VIEWER],
  [Relation.EDITOR]: [Relation.EDITOR, Relation.VIEWER],
  [Relation.VIEWER]: [Relation.VIEWER],
};

const SUBJECT_TYPE = 'user';

@Injectable()
export class RelationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Idempotent grant — re-granting the same tuple is a no-op, not a conflict.
  async grant(
    subjectId: string,
    relation: Relation,
    objectType: string,
    objectId: string,
  ): Promise<void> {
    await this.prisma.relationTuple.upsert({
      where: {
        subjectType_subjectId_relation_objectType_objectId: {
          subjectType: SUBJECT_TYPE,
          subjectId,
          relation,
          objectType,
          objectId,
        },
      },
      create: { subjectType: SUBJECT_TYPE, subjectId, relation, objectType, objectId },
      update: {},
    });
    this.emitChanged(subjectId, objectType, objectId);
  }

  async revoke(
    subjectId: string,
    relation: Relation,
    objectType: string,
    objectId: string,
  ): Promise<void> {
    const { count } = await this.prisma.relationTuple.deleteMany({
      where: { subjectType: SUBJECT_TYPE, subjectId, relation, objectType, objectId },
    });
    if (count === 0) throw new NotFoundException('Relation tuple not found.');
    this.emitChanged(subjectId, objectType, objectId);
  }

  // True if the subject holds `required` (directly or via a stronger relation).
  async check(
    subjectId: string,
    required: Relation,
    objectType: string,
    objectId: string,
  ): Promise<boolean> {
    const tuple = await this.prisma.relationTuple.findFirst({
      where: {
        subjectType: SUBJECT_TYPE,
        subjectId,
        objectType,
        objectId,
        relation: { in: this.grantorsOf(required) },
      },
      select: { id: true },
    });
    return !!tuple;
  }

  // Bulk variant of check() for a page of objects: returns the set of objectIds
  // (within `objectIds`) on which the subject holds `required` or stronger. One
  // query instead of one per object — avoids an N+1 in list filtering.
  async satisfyingObjectIds(
    subjectId: string,
    required: Relation,
    objectType: string,
    objectIds: string[],
  ): Promise<Set<string>> {
    if (objectIds.length === 0) return new Set();
    const tuples = await this.prisma.relationTuple.findMany({
      where: {
        subjectType: SUBJECT_TYPE,
        subjectId,
        objectType,
        objectId: { in: objectIds },
        relation: { in: this.grantorsOf(required) },
      },
      select: { objectId: true },
    });
    return new Set(tuples.map((t) => t.objectId));
  }

  // Relations that satisfy `required` via the implication map.
  private grantorsOf(required: Relation): Relation[] {
    return (Object.keys(RELATION_IMPLIES) as Relation[]).filter((r) =>
      RELATION_IMPLIES[r].includes(required),
    );
  }

  private emitChanged(subjectId: string, objectType: string, objectId: string): void {
    this.eventEmitter.emit('authz.relation.changed', { subjectId, objectType, objectId });
  }
}
