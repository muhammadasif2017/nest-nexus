import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POLICY_KEY } from '../decorators/policy.decorator';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { evaluatePolicy } from '../../modules/authorization/abac/policies';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getRequestFromContext } from '../utils/execution-context.util';

// ABAC layer. Loads the document named by the :id route param and evaluates the
// named policy's predicate over the user + resource attributes. super_admin
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

    const req = getRequestFromContext(context);
    const user = req.user;
    if (this.authz.isSuperAdmin(user)) return true;

    const id = req.params?.id;
    if (!id) throw new ForbiddenException('Policy guard requires an :id route param.');

    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { ownerId: true, visibility: true },
    });
    if (!document) throw new NotFoundException('Document not found.');

    if (!evaluatePolicy(name, { user, resource: document })) {
      throw new ForbiddenException('Policy denied.');
    }
    return true;
  }
}
