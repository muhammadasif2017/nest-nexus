import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RELATION_KEY, RelationMeta } from '../decorators/require-relation.decorator';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { RelationService } from '../../modules/authorization/rebac/relation.service';
import { getRequestFromContext } from '../utils/execution-context.util';

// ReBAC layer. Requires the user to hold the @RequireRelation relation (or a
// stronger one, via implication) on the resource named by the :id route param.
// super_admin bypasses. Single-resource routes only (needs :id).
@Injectable()
export class RelationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    private readonly relation: RelationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RelationMeta | undefined>(RELATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const { relation: required, resource } = meta;
    const req = getRequestFromContext(context);
    const user = req.user;
    if (this.authz.isSuperAdmin(user)) return true;

    const id = req.params?.id;
    if (!id) throw new ForbiddenException('Relation guard requires an :id route param.');

    const ok = await this.relation.check(user.sub, required, resource, id);
    if (!ok) throw new ForbiddenException('Relationship requirement not met.');
    return true;
  }
}
