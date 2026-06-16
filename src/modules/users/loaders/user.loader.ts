import { Injectable, Scope } from '@nestjs/common';
import { User } from '@prisma/client';
import DataLoader from 'dataloader';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  constructor(private readonly prisma: PrismaService) {}

  readonly batchUsers = new DataLoader<string, User | null>(
    async (userIds: readonly string[]) => {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...userIds] } },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));
      return userIds.map((id) => userMap.get(id) ?? null);
    },
    { cache: true },
  );
}
