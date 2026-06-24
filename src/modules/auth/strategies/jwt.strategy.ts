import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  // 'two_factor_pending' tokens are issued during login when 2FA is enabled.
  // They are only accepted on routes decorated with @AllowPending2FA().
  scope?: 'two_factor_pending';
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  // Caches isActive status + current roles per user for 30s to avoid a DB
  // round-trip on every request. Deactivated users are blocked within 30s, and a
  // role change takes effect within 30s — acceptable since the JWT is 15 min.
  // Roles are sourced from the DB here (not trusted from the token) so a role
  // change applies to already-issued tokens without waiting for refresh.
  private readonly activeCache = new Map<string, { ok: boolean; roles: string[]; exp: number }>();
  private static readonly CACHE_TTL = 30_000;
  private static readonly MAX_CACHE_SIZE = 10_000;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const now = Date.now();
    const cached = this.activeCache.get(payload.sub);
    if (cached && cached.exp > now) {
      if (!cached.ok) throw new UnauthorizedException('User account is inactive or not found.');
      // Copy: the cached array is shared across requests — never hand out the reference.
      return { ...payload, roles: [...cached.roles] };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, roles: true },
    });

    const ok = !!user?.isActive;
    this.setCacheEntry(payload.sub, {
      ok,
      roles: user?.roles ?? [],
      exp: now + JwtStrategy.CACHE_TTL,
    });

    if (!ok) throw new UnauthorizedException('User account is inactive or not found.');
    // Override the token's roles with the DB source of truth — a role change
    // applies here without waiting for the token to refresh. Copy: this array is
    // also held in the cache entry — never hand out the cached reference.
    return { ...payload, roles: [...(user?.roles ?? [])] };
  }

  private setCacheEntry(
    userId: string,
    entry: { ok: boolean; roles: string[]; exp: number },
  ): void {
    this.activeCache.set(userId, entry);
    if (this.activeCache.size > JwtStrategy.MAX_CACHE_SIZE) {
      const now = Date.now();
      for (const [key, val] of this.activeCache) {
        if (val.exp <= now) this.activeCache.delete(key);
      }
    }
  }

  invalidateUserCache(userId: string): void {
    this.activeCache.delete(userId);
  }

  @OnEvent('user.updated')
  @OnEvent('user.deactivated')
  onUserChanged(payload: { userId: string }): void {
    this.activeCache.delete(payload.userId);
  }
}
