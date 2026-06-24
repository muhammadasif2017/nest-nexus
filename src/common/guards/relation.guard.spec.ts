import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RelationGuard } from './relation.guard';
import { AuthorizationService } from '../../modules/authorization/authorization.service';
import { RelationService, Relation } from '../../modules/authorization/rebac/relation.service';

const mockReflector = (rel: Relation | undefined) =>
  ({ getAllAndOverride: jest.fn().mockReturnValue(rel) }) as unknown as Reflector;

const httpContext = (user: unknown, id?: string): ExecutionContext =>
  ({
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params: { id } }) }),
  }) as unknown as ExecutionContext;

describe('RelationGuard', () => {
  const authz = new AuthorizationService({ check: jest.fn() } as never);
  let relation: { check: jest.Mock };

  beforeEach(() => {
    relation = { check: jest.fn() };
  });

  const build = (rel: Relation | undefined) =>
    new RelationGuard(mockReflector(rel), authz, relation as unknown as RelationService);

  it('allows when no @RequireRelation metadata', async () => {
    expect(await build(undefined).canActivate(httpContext({ roles: [] }))).toBe(true);
    expect(relation.check).not.toHaveBeenCalled();
  });

  it('bypasses for super_admin without checking tuples', async () => {
    expect(
      await build(Relation.OWNER).canActivate(httpContext({ roles: ['super_admin'] }, 'd1')),
    ).toBe(true);
    expect(relation.check).not.toHaveBeenCalled();
  });

  it('throws Forbidden when :id param is missing', async () => {
    await expect(
      build(Relation.EDITOR).canActivate(httpContext({ sub: 'u1', roles: ['user'] })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows when the relation check passes', async () => {
    relation.check.mockResolvedValue(true);
    expect(
      await build(Relation.EDITOR).canActivate(httpContext({ sub: 'u1', roles: ['user'] }, 'd1')),
    ).toBe(true);
    expect(relation.check).toHaveBeenCalledWith('u1', Relation.EDITOR, 'document', 'd1');
  });

  it('throws Forbidden when the relation is missing', async () => {
    relation.check.mockResolvedValue(false);
    await expect(
      build(Relation.OWNER).canActivate(httpContext({ sub: 'u1', roles: ['user'] }, 'd1')),
    ).rejects.toThrow(ForbiddenException);
  });
});
