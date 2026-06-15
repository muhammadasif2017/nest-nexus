import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { UserLoader } from './loaders/user.loader';
import { UpdateUserInput } from './dto/update-user.input';
import { UserOutput } from './dto/user.output';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userLoader: UserLoader,
  ) {}

  async findAll(): Promise<UserOutput[]> {
    const users = await this.prisma.user.findMany({ where: { isActive: true } });
    return plainToInstance(UserOutput, users, { excludeExtraneousValues: true });
  }

  async findById(id: string): Promise<UserOutput> {
    const user = await this.userLoader.batchUsers.load(id);
    if (!user) throw new NotFoundException(`User with id ${id} not found.`);
    return plainToInstance(UserOutput, user, { excludeExtraneousValues: true });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async update(id: string, dto: UpdateUserInput): Promise<UserOutput> {
    try {
      const updated = await this.prisma.user.update({ where: { id }, data: dto });
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
      return plainToInstance(UserOutput, updated, { excludeExtraneousValues: true });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`User with id ${id} not found.`);
      }
      throw e;
    }
  }
}
