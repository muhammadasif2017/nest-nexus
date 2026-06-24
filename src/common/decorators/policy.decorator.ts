import { SetMetadata } from '@nestjs/common';

// Metadata key shared by @Policy and PolicyGuard.
export const POLICY_KEY = 'policy';

// @Policy('document.read') — route is gated by the named ABAC policy. The guard
// loads the resource by the :id route param and evaluates the policy's predicate.
export const Policy = (name: string) => SetMetadata(POLICY_KEY, name);
