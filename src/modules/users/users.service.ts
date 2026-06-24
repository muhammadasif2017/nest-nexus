import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { UpdateUserInput } from './dto/update-user.input';
import { UserOutput } from './dto/user.output';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  roles: true,
  isEmailVerified: true,
  isActive: true,
  avatarUrl: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findAll(): Promise<UserOutput[]> {
    const cached = await this.cache.get<UserOutput[]>('users:all');
    if (cached) return cached;

    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: USER_SELECT,
    });
    const result = this.toOutput(users);
    await this.cache.set('users:all', result);
    return result;
  }

  async findById(id: string): Promise<UserOutput> {
    const key = `users:id:${id}`;
    const cached = await this.cache.get<UserOutput>(key);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException(`User with id ${id} not found.`);
    const result = this.toOutput(user);
    await this.cache.set(key, result);
    return result;
  }

  async findByEmail(email: string) {
    // Not cached — always needs fresh data (includes password for auth)
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async update(id: string, dto: UpdateUserInput): Promise<UserOutput> {
    const updated = await this.prisma.user
      .update({ where: { id }, data: dto })
      .catch((e) => this.rethrowNotFound(e, id));
    this.eventEmitter.emit('user.updated', { userId: id });
    return this.toOutput(updated);
  }

  // Replaces a user's role set wholesale. The route is super_admin-gated; this
  // method adds the one invariant a guard cannot express: the system must never
  // be left with zero super_admins. Demoting the last one would lock everyone
  // out of role management permanently (no route can re-grant super_admin).
  // Emits user.updated so JwtStrategy drops its cached roles for this user; the
  // change then applies to already-issued tokens (JwtStrategy reads roles from
  // the DB, not the token) within the 30s cache window.
  async setRoles(id: string, roles: Role[]): Promise<UserOutput> {
    // The check (is this the last super_admin?) and the write must be atomic, or
    // two concurrent demotions of different super_admins could each see count > 1
    // and both proceed — leaving zero. Serializable isolation makes the read+write
    // a single conflict-detected unit.
    const updated = await this.prisma
      .$transaction(
        async (tx) => {
          if (!roles.includes(Role.SUPER_ADMIN)) {
            const target = await tx.user.findUnique({
              where: { id },
              select: { roles: true },
            });
            if (!target) throw new NotFoundException(`User with id ${id} not found.`);
            if (target.roles.includes(Role.SUPER_ADMIN)) {
              const superAdmins = await tx.user.count({
                where: { roles: { has: Role.SUPER_ADMIN } },
              });
              if (superAdmins <= 1) {
                throw new ConflictException('Cannot remove the last super_admin.');
              }
            }
          }
          return tx.user.update({ where: { id }, data: { roles } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((e) => this.rethrowNotFound(e, id));
    this.eventEmitter.emit('user.updated', { userId: id });
    return this.toOutput(updated);
  }

  async deactivate(id: string): Promise<UserOutput> {
    const updated = await this.prisma.user
      .update({ where: { id }, data: { isActive: false } })
      .catch((e) => this.rethrowNotFound(e, id));
    this.eventEmitter.emit('user.deactivated', { userId: id });
    return this.toOutput(updated);
  }

  private toOutput(data: object[]): UserOutput[];
  private toOutput(data: object): UserOutput;
  private toOutput(data: object | object[]): UserOutput | UserOutput[] {
    return plainToInstance(UserOutput, data, { excludeExtraneousValues: true });
  }

  private rethrowNotFound(e: unknown, id: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundException(`User with id ${id} not found.`);
    }
    throw e;
  }
}
