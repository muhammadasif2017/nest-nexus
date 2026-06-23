import { Role } from '../../../common/enums/role.enum';
import { Permission } from '../../../common/enums/permission.enum';

// RBAC ↔ Scopes bridge: a role expands to a set of permission strings.
// This is the single source of truth for "what a kind of user can do."
// super_admin is intentionally absent — it short-circuits to allow in
// AuthorizationService and never consults this map.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.USER]: [Permission.DOCUMENT_READ, Permission.DOCUMENT_WRITE, Permission.DOCUMENT_DELETE],
  [Role.MODERATOR]: [
    Permission.DOCUMENT_READ,
    Permission.DOCUMENT_WRITE,
    Permission.DOCUMENT_DELETE,
    Permission.DOCUMENT_READ_ANY,
  ],
  [Role.ADMIN]: [
    Permission.DOCUMENT_READ,
    Permission.DOCUMENT_WRITE,
    Permission.DOCUMENT_DELETE,
    Permission.DOCUMENT_READ_ANY,
  ],
  [Role.SUPER_ADMIN]: [],
};
