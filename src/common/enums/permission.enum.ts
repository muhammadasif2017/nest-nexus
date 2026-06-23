// Fine-grained permission strings in `<resource>:<action>` form.
// These are the "scopes" checked by PermissionsGuard / @RequirePermission and
// resolved from a user's roles via ROLE_PERMISSIONS (role-derived only — there
// are no per-user direct grants; per-user-per-object access is ReBAC's job).
export enum Permission {
  // Act on a document the user is related to (owner/editor/viewer) — the
  // relationship/attribute check (ReBAC/ABAC) decides *which* document.
  DOCUMENT_READ = 'document:read',
  DOCUMENT_WRITE = 'document:write',
  DOCUMENT_DELETE = 'document:delete',

  // Cross-cutting scope: read any document regardless of relationship.
  // Granted to elevated roles (moderator/admin).
  DOCUMENT_READ_ANY = 'document:read:any',
}
