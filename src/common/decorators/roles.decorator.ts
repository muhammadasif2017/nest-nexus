import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

// This is a metadata key — a string constant that both the @Roles() decorator
// and the RolesGuard agree on as the "address" for role metadata.
export const ROLES_KEY = 'roles';

// @Roles(Role.ADMIN, Role.SUPER_ADMIN) — attach this to any resolver or controller.
// Under the hood, this just calls SetMetadata, which stores the roles array
// on the route handler's metadata, where the RolesGuard will later read it.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);