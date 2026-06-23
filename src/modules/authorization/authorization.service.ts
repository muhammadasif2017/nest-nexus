import { Injectable } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { Permission } from '../../common/enums/permission.enum';
import { ROLE_PERMISSIONS } from './rbac/role-permissions.map';
import { RelationService, Relation } from './rebac/relation.service';
import { evaluatePolicy, DocumentAttrs } from './abac/policies';

// The authenticated subject, as it appears on req.user (the JWT payload).
// `sub` is the user id, `roles` drives both RBAC and the scope mapping.
export interface AuthSubject {
  sub: string;
  roles: string[];
}

// A document resource as seen by the object-level decision (id + ABAC attrs).
export type DocumentResource = DocumentAttrs & { id: string };

const DOCUMENT = 'document';

// Central authorization decision point. Guards delegate to the individual slices
// (hasPermission / evaluatePolicy / RelationService.check); feature services call
// can() for the full composed object-level decision a route guard cannot make.
@Injectable()
export class AuthorizationService {
  constructor(private readonly relation: RelationService) {}

  // super_admin short-circuits every decision to ALLOW and never consults the
  // permission map. This is the only role with implicit, unconditional access.
  isSuperAdmin(user: AuthSubject | undefined | null): boolean {
    return !!user?.roles?.includes(Role.SUPER_ADMIN);
  }

  // RBAC → Scopes: does any of the user's roles grant this permission?
  hasPermission(user: AuthSubject | undefined | null, permission: Permission): boolean {
    if (!user?.roles) return false;
    if (this.isSuperAdmin(user)) return true;
    return user.roles.some((role) => ROLE_PERMISSIONS[role as Role]?.includes(permission));
  }

  // Full composed object-level decision for a single document. Deny-by-default:
  // the action must clear its RBAC scope gate AND a model-specific access check.
  //   read   → scope + (read:any | ABAC visibility | ReBAC viewer)
  //   write  → scope + (owner | ReBAC editor)
  //   delete → scope + (owner | ReBAC owner)
  async can(
    user: AuthSubject | undefined | null,
    action: Permission,
    resource: DocumentResource,
  ): Promise<boolean> {
    if (!user) return false;
    if (this.isSuperAdmin(user)) return true;

    switch (action) {
      case Permission.DOCUMENT_READ:
        if (!this.hasPermission(user, Permission.DOCUMENT_READ)) return false;
        if (this.hasPermission(user, Permission.DOCUMENT_READ_ANY)) return true;
        if (evaluatePolicy('document.read', { user, resource })) return true;
        return this.relation.check(user.sub, Relation.VIEWER, DOCUMENT, resource.id);

      case Permission.DOCUMENT_WRITE:
        if (!this.hasPermission(user, Permission.DOCUMENT_WRITE)) return false;
        if (resource.ownerId === user.sub) return true;
        return this.relation.check(user.sub, Relation.EDITOR, DOCUMENT, resource.id);

      case Permission.DOCUMENT_DELETE:
        if (!this.hasPermission(user, Permission.DOCUMENT_DELETE)) return false;
        if (resource.ownerId === user.sub) return true;
        return this.relation.check(user.sub, Relation.OWNER, DOCUMENT, resource.id);

      default:
        return false;
    }
  }
}
