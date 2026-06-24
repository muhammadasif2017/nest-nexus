import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RELATION_KEY } from '../decorators/require-relation.decorator';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { RelationService, Relation } from '../../modules/authorization/rebac/relation.service';
import { getRequestFromContext } from '../utils/execution-context.util';

const DOCUMENT = 'document';

// ReBAC layer. Requires the user to hold the @RequireRelation relation (or a
// stronger one, via implication) on the document named by the :id route param.
// super_admin bypasses. Single-resource routes only (needs :id).
@Injectable()
export class RelationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    private readonly relation: RelationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Relation>(RELATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = getRequestFromContext(context);
    const user = req.user;
    if (this.authz.isSuperAdmin(user)) return true;

    const id = req.params?.id;
    if (!id) throw new ForbiddenException('Relation guard requires an :id route param.');

    const ok = await this.relation.check(user.sub, required, DOCUMENT, id);
    if (!ok) throw new ForbiddenException('Relationship requirement not met.');
    return true;
  }
}
