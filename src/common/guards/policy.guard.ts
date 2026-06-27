import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POLICY_KEY } from '../decorators/policy.decorator';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { evaluatePolicy } from '../../modules/authorization/abac/policies';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getRequestFromContext } from '../utils/execution-context.util';

// Resource types this guard knows how to load. Throw ISE for anything else so a
// dev adding @Policy to a non-document route gets a clear programmer error, not
// silent wrong-resource evaluation.
const SUPPORTED_RESOURCES = new Set(['document']);

// ABAC layer. Loads the resource named by the :id route param and evaluates the
// named policy's predicate over the user + resource attributes. The resource type
// is derived from the policy name prefix (<resource>.<action>). super_admin
// bypasses. Single-resource routes only (needs :id).
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<string>(POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!name) return true;

    const resourceType = name.split('.')[0];
    if (!SUPPORTED_RESOURCES.has(resourceType)) {
      throw new InternalServerErrorException(
        `PolicyGuard does not support resource type '${resourceType}' (policy: '${name}'). ` +
          `Add a loader for this resource type before using @Policy here.`,
      );
    }

    const req = getRequestFromContext(context);
    const user = req.user;
    if (this.authz.isSuperAdmin(user)) return true;

    const id = req.params?.id;
    if (!id) throw new ForbiddenException('Policy guard requires an :id route param.');

    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { ownerId: true, visibility: true },
    });
    // No-enumeration: a denied attribute-read is reported as 404, identical to a
    // missing resource, so a caller cannot probe which ids exist. See ADR-028.
    if (!document || !evaluatePolicy(name, { user, resource: document })) {
      throw new NotFoundException('Document not found.');
    }
    return true;
  }
}
