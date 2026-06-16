import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { UserLoader } from './loaders/user.loader';
import { UpdateUserInput } from './dto/update-user.input';
import { UserOutput } from './dto/user.output';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userLoader: UserLoader,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findAll(): Promise<UserOutput[]> {
    const cached = await this.cache.get<UserOutput[]>('users:all');
    if (cached) return cached;

    const users = await this.prisma.user.findMany({ where: { isActive: true } });
    const result = plainToInstance(UserOutput, users, { excludeExtraneousValues: true });
    await this.cache.set('users:all', result);
    return result;
  }

  async findById(id: string): Promise<UserOutput> {
    const key = `users:id:${id}`;
    const cached = await this.cache.get<UserOutput>(key);
    if (cached) return cached;

    const user = await this.userLoader.batchUsers.load(id);
    if (!user) throw new NotFoundException(`User with id ${id} not found.`);
    const result = plainToInstance(UserOutput, user, { excludeExtraneousValues: true });
    await this.cache.set(key, result);
    return result;
  }

  async findByEmail(email: string) {
    // Not cached — always needs fresh data (includes password for auth)
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async update(id: string, dto: UpdateUserInput): Promise<UserOutput> {
    try {
      const updated = await this.prisma.user.update({ where: { id }, data: dto });
      this.eventEmitter.emit('user.updated', { userId: id });
      return plainToInstance(UserOutput, updated, { excludeExtraneousValues: true });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`User with id ${id} not found.`);
      }
      throw e;
    }
  }

  async deactivate(id: string): Promise<UserOutput> {
    try {
      const updated = await this.prisma.user.update({ where: { id }, data: { isActive: false } });
      this.eventEmitter.emit('user.deactivated', { userId: id });
      return plainToInstance(UserOutput, updated, { excludeExtraneousValues: true });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`User with id ${id} not found.`);
      }
      throw e;
    }
  }
}
