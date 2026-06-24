import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permission.enum';

// Metadata key shared by @RequirePermission and PermissionsGuard.
export const PERMISSION_KEY = 'permission';

// @RequirePermission(Permission.DOCUMENT_WRITE) — route requires ALL listed
// permissions (scopes). Resolved from the user's roles via ROLE_PERMISSIONS.
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
