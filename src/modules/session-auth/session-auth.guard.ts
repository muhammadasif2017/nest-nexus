import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Request } from 'express';
import { PrismaService } from '../../core/prisma/prisma.service';

interface CachedSessionUser {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  exp: number;
}

@Injectable()
export class SessionGuard implements CanActivate {
  // 30s TTL — same rationale as JwtStrategy: session users deactivated within one cache window.
  private static readonly CACHE_TTL = 30_000;
  private static readonly MAX_CACHE_SIZE = 10_000;
  private readonly userCache = new Map<string, CachedSessionUser>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = this.getRequest(context);
    const userId = (request.session as any)?.userId as string | undefined;

    if (!userId) {
      throw new UnauthorizedException('No active session.');
    }

    const now = Date.now();
    const cached = this.userCache.get(userId);
    if (cached && cached.exp > now) {
      if (!cached.isActive) throw new UnauthorizedException('Session user not found or inactive.');
      (request as any).user = cached;
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, roles: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Session user not found or inactive.');
    }

    this.setCacheEntry(userId, { ...user, exp: now + SessionGuard.CACHE_TTL });

    // Populate req.user so @CurrentUser() works on session-protected routes
    (request as any).user = user;
    return true;
  }

  private setCacheEntry(userId: string, entry: CachedSessionUser): void {
    this.userCache.set(userId, entry);
    if (this.userCache.size > SessionGuard.MAX_CACHE_SIZE) {
      const now = Date.now();
      for (const [key, val] of this.userCache) {
        if (val.exp <= now) this.userCache.delete(key);
      }
    }
  }

  @OnEvent('user.updated')
  @OnEvent('user.deactivated')
  onUserChanged(payload: { userId: string }): void {
    this.userCache.delete(payload.userId);
  }

  private getRequest(context: ExecutionContext): Request {
    return context.switchToHttp().getRequest<Request>();
  }
}
