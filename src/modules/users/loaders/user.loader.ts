import { Injectable, Scope } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import DataLoader from 'dataloader';
import { PrismaService } from '../../../prisma/prisma.service';

const USER_SELECT = {
  id: true, email: true, displayName: true, roles: true,
  isEmailVerified: true, isActive: true, avatarUrl: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
} as const;

export type LoadedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  constructor(private readonly prisma: PrismaService) {}

  readonly batchUsers = new DataLoader<string, LoadedUser | null>(
    async (userIds: readonly string[]) => {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: USER_SELECT,
      });
      const userMap = new Map(users.map((u) => [u.id, u]));
      return userIds.map((id) => userMap.get(id) ?? null);
    },
    { cache: true },
  );
}
