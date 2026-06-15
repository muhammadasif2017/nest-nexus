import {
  Injectable, UnauthorizedException, ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { UserOutput } from '../users/dto/user.output';
import { TokenService } from './token.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthOutput } from './dto/auth.output';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterInput): Promise<{ auth: AuthOutput; refreshToken: string }> {
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

    return this.buildAuthResponse(newUser);
  }

  async login(
    dto: LoginInput,
    ipAddress?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    const dummyHash = '$2b$12$invalidhashpaddingtomatch.the.bcrypt.output.format';
    const passwordHash = user?.password ?? dummyHash;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated. Please contact support.');
    }

    this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: ipAddress } })
      .catch(() => {});

    return this.buildAuthResponse(user);
  }

  async logout(userId: string): Promise<void> {
    await this.tokenService.revokeAllTokens(userId);
  }

  async refresh(rawRefreshToken: string): Promise<{
    auth: Omit<AuthOutput, 'user'> & { user?: UserOutput };
    refreshToken: string;
  }> {
    const { accessToken, refreshToken } = await this.tokenService.rotateRefreshToken(rawRefreshToken);
    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const expiresAt = this.parseExpiresIn(expiresIn);
    return { auth: { accessToken, accessTokenExpiresAt: expiresAt } as any, refreshToken };
  }

  private async buildAuthResponse(
    user: User,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(user.id);

    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const accessTokenExpiresAt = this.parseExpiresIn(expiresIn);

    const userOutput = plainToInstance(UserOutput, user, { excludeExtraneousValues: true });
    const auth: AuthOutput = { accessToken, user: userOutput, accessTokenExpiresAt };
    return { auth, refreshToken };
  }

  private parseExpiresIn(expiresIn: string): Date {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(Date.now() + 15 * 60 * 1000);
    const [, amount, unit] = match;
    const multipliers: Record<string, number> = {
      s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + parseInt(amount) * multipliers[unit]);
  }
}
