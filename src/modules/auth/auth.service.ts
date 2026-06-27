import {
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UserOutput } from '../users/dto/user.output';
import { TokenService } from './token.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthOutput } from './dto/auth.output';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User, Prisma } from '@prisma/client';
import { OAuthProfile } from './oauth/strategies/google.strategy';
import { parseExpiryDate } from '../../common/utils/duration.util';

type UserForAuth = Pick<
  User,
  | 'id'
  | 'email'
  | 'displayName'
  | 'roles'
  | 'isEmailVerified'
  | 'isActive'
  | 'avatarUrl'
  | 'lastLoginAt'
  | 'createdAt'
  | 'updatedAt'
  | 'isTwoFactorEnabled'
>;

const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCKOUT_TTL_MS = 15 * 60 * 1000;
const loginFailKey = (ip: string, email: string) => `login:fail:${ip}:${email}`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async register(
    dto: RegisterInput,
    userAgent?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true },
    });
    if (exists) {
      throw new ConflictException('An account with this email address already exists.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        displayName: dto.displayName,
        password: hashedPassword,
        lastLoginAt: new Date(),
      },
    });

    this.eventEmitter.emit('user.created', { userId: newUser.id });
    return this.buildAuthResponse(newUser, userAgent);
  }

  async login(
    dto: LoginInput,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const email = dto.email.toLowerCase();
    const failKey = loginFailKey(ipAddress ?? 'unknown', email);

    const failCount = Number(await this.cache.get(failKey)) || 0;
    if (failCount >= LOGIN_MAX_FAILURES) {
      throw new HttpException(
        'Account temporarily locked due to too many failed login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Must be a valid 60-char bcrypt hash so compare() runs the full KDF work factor,
    // preventing timing attacks that reveal whether the email exists.
    const dummyHash = '$2b$12$LlxSWCRB6GdBk9m4LPHIAeOELn5X7YV5l1Kp6Kgv4H9ZfXhVLMnaX';
    const passwordHash = user?.password ?? dummyHash;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !isPasswordValid) {
      await this.cache.set(failKey, failCount + 1, LOGIN_LOCKOUT_TTL_MS);
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.cache.del(failKey);

    if (!user.isActive) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: ipAddress } })
      .catch((err) => this.logger.warn(err, 'lastLoginAt update failed'));

    // 2FA is enabled — issue a short-lived pending token instead of a full session
    if (user.isTwoFactorEnabled) return this.buildPendingTwoFactorResponse(user);

    return this.buildAuthResponse(user, userAgent);
  }

  // Issues a full token pair for a user whose identity has already been verified
  // (post-2FA check, magic link, or OAuth callback). Not a replacement for login().
  async issueTokens(
    userId: string,
    userAgent?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
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
        isTwoFactorEnabled: true,
      },
    });
    if (!user || !user.isActive) throw new NotFoundException('User not found or inactive.');
    return this.buildAuthResponse(user, userAgent);
  }

  async oauthLogin(
    profile: OAuthProfile,
    userAgent?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    // Try finding an existing OAuth link first
    let user: UserForAuth | null = null;

    const existing = await this.prisma.oauthProvider.findUnique({
      where: {
        provider_providerId: { provider: profile.provider, providerId: profile.providerId },
      },
      select: {
        user: {
          select: {
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
            isTwoFactorEnabled: true,
          },
        },
      },
    });

    if (existing) {
      user = existing.user;
    } else if (profile.email) {
      // Link OAuth to existing account that has the same email (or no-op if link already exists)
      try {
        user = await this.prisma.user.update({
          where: { email: profile.email.toLowerCase() },
          data: {
            oauthProviders: {
              connectOrCreate: {
                where: {
                  provider_providerId: {
                    provider: profile.provider,
                    providerId: profile.providerId,
                  },
                },
                create: {
                  provider: profile.provider,
                  providerId: profile.providerId,
                  providerEmail: profile.email,
                },
              },
            },
          },
          select: {
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
            isTwoFactorEnabled: true,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          user = null; // No existing account with this email
        } else {
          throw e;
        }
      }
    }

    if (!user) {
      // No existing account — create one (no password for OAuth-only users)
      try {
        user = await this.prisma.user.create({
          data: {
            email: (
              profile.email ?? `${profile.providerId}@${profile.provider}.oauth`
            ).toLowerCase(),
            displayName: profile.displayName,
            hasPassword: false,
            lastLoginAt: new Date(),
            oauthProviders: {
              create: {
                provider: profile.provider,
                providerId: profile.providerId,
                providerEmail: profile.email,
              },
            },
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'An account with this email already exists. Please log in and link your OAuth provider.',
          );
        }
        throw e;
      }
      this.eventEmitter.emit('user.created', { userId: user.id });
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated. Please contact support.');
    }

    if (user.isTwoFactorEnabled) return this.buildPendingTwoFactorResponse(user);

    return this.buildAuthResponse(user, userAgent);
  }

  async logout(userId: string): Promise<void> {
    await this.tokenService.revokeAllTokens(userId);
  }

  async refresh(rawRefreshToken: string): Promise<{
    auth: Omit<AuthOutput, 'user'> & { user?: UserOutput };
    refreshToken: string;
  }> {
    const { accessToken, refreshToken } =
      await this.tokenService.rotateRefreshToken(rawRefreshToken);
    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const expiresAt = parseExpiryDate(expiresIn, 15 * 60 * 1000);
    return { auth: { accessToken, accessTokenExpiresAt: expiresAt } as any, refreshToken };
  }

  private buildPendingTwoFactorResponse(user: UserForAuth): {
    auth: AuthOutput;
    refreshToken: string;
  } {
    const pendingToken = this.tokenService.generatePendingTwoFactorToken(user);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    return {
      auth: {
        accessToken: pendingToken,
        isTwoFactorPending: true,
        accessTokenExpiresAt: expiresAt,
      } as any,
      refreshToken: '',
    };
  }

  private async buildAuthResponse(
    user: UserForAuth,
    userAgent?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(user.id, { userAgent });

    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const accessTokenExpiresAt = parseExpiryDate(expiresIn, 15 * 60 * 1000);

    const userOutput = plainToInstance(UserOutput, user, { excludeExtraneousValues: true });
    const auth: AuthOutput = { accessToken, user: userOutput, accessTokenExpiresAt };
    return { auth, refreshToken };
  }
}
