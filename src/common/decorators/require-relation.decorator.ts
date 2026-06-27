import { SetMetadata } from '@nestjs/common';
import { Relation } from '../../modules/authorization/rebac/relation.service';

// Metadata key shared by @RequireRelation and RelationGuard.
export const RELATION_KEY = 'relation';

export interface RelationMeta {
  relation: Relation;
  resource: string;
}

// @RequireRelation(Relation.EDITOR, 'document') — route requires the user to hold
// the given ReBAC relation (or a stronger one) on the named resource type, looked
// up by the :id route param. `resource` must be explicit — no default — so a dev
// adding this decorator to a non-document route cannot accidentally check document
// relation tuples.
export const RequireRelation = (relation: Relation, resource: string) =>
  SetMetadata(RELATION_KEY, { relation, resource } satisfies RelationMeta);
