import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RefreshToken } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from './strategies/jwt.strategy';
import { DeviceSessionOutput } from './dto/device-session.output';

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  family: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  generateAccessToken(user: { id: string; email: string; roles: string[] }): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };
    return this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn') as any,
    });
  }

  async rotateRefreshToken(rawToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    userId: string;
  }> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(rawToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, roles: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive.');
    }

    const familyTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub, family: payload.family },
    });

    let matchedToken: RefreshToken | null = null;
    for (const candidate of familyTokens) {
      const matches = await bcrypt.compare(rawToken, candidate.tokenHash);
      if (matches) { matchedToken = candidate; break; }
    }

    if (!matchedToken) {
      if (familyTokens.length > 0) {
        await this.revokeTokenFamily(payload.sub, payload.family);
      }
      throw new UnauthorizedException('Refresh token has already been used. Please log in again.');
    }

    if (matchedToken.isRevoked) {
      throw new UnauthorizedException('Refresh token has been revoked.');
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedToken.id },
      data: { isRevoked: true },
    });

    const newRefreshToken = await this.generateRefreshToken(user.id, {
      existingFamily: payload.family,
    });
    const newAccessToken = this.generateAccessToken(user);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken, userId: user.id };
  }

  async revokeAllTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  private async revokeTokenFamily(userId: string, family: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId, family } });
  }

  private async pruneExpiredTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lt: new Date() } }, { isRevoked: true }],
      },
    });
  }

  getRefreshTokenCookieOptions() {
    const isProd = this.config.get('app.nodeEnv') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  parseDeviceName(userAgent?: string): string {
    if (!userAgent) return 'Unknown Device';
    if (/iPhone|iPad/.test(userAgent)) return 'iOS Device';
    if (/Android/.test(userAgent)) return 'Android Device';
    if (/Windows/.test(userAgent)) return 'Windows Device';
    if (/Mac/.test(userAgent)) return 'Mac Device';
    if (/Linux/.test(userAgent)) return 'Linux Device';
    return 'Unknown Device';
  }

  async listDeviceSessions(
    userId: string,
    currentDeviceId?: string,
  ): Promise<DeviceSessionOutput[]> {
    const now = new Date();
    const tokens = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: now },
        deviceId: { not: null },
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    const deviceMap = new Map<string, RefreshToken>();
    for (const token of tokens) {
      if (!token.deviceId) continue;
      const existing = deviceMap.get(token.deviceId);
      if (!existing || (token.lastUsedAt && (!existing.lastUsedAt || token.lastUsedAt > existing.lastUsedAt))) {
        deviceMap.set(token.deviceId, token);
      }
    }

    return Array.from(deviceMap.values()).map((token) => ({
      deviceId: token.deviceId!,
      deviceName: token.deviceName ?? undefined,
      userAgent: token.userAgent ?? undefined,
      lastUsedAt: token.lastUsedAt ?? token.createdAt,
      createdAt: token.createdAt,
      isCurrent: token.deviceId === currentDeviceId,
    }));
  }

  async revokeDeviceSession(userId: string, deviceId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId, deviceId } });
  }

  async generateRefreshToken(
    userId: string,
    options?: {
      existingFamily?: string;
      deviceId?: string;
      userAgent?: string;
    },
  ): Promise<string> {
    const jti = crypto.randomUUID();
    const family = options?.existingFamily ?? crypto.randomUUID();
    const deviceId = options?.deviceId ?? crypto.randomUUID();

    const payload: RefreshTokenPayload = { sub: userId, jti, family };
    const rawToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn') as any,
    });

    const tokenHash = await bcrypt.hash(rawToken, 8);
    const now = new Date();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        jti,
        family,
        deviceId,
        deviceName: this.parseDeviceName(options?.userAgent),
        userAgent: options?.userAgent,
        lastUsedAt: now,
        createdAt: now,
      },
    });

    this.pruneExpiredTokens(userId).catch(() => {});
    return rawToken;
  }
}
