import { SetMetadata } from '@nestjs/common';
import { Relation } from '../../modules/authorization/rebac/relation.service';

// Metadata key shared by @RequireRelation and RelationGuard.
export const RELATION_KEY = 'relation';

// @RequireRelation(Relation.EDITOR) — route requires the user to hold the given
// ReBAC relation (or a stronger one) on the document named by the :id param.
export const RequireRelation = (relation: Relation) => SetMetadata(RELATION_KEY, relation);
