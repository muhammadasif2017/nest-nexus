import {
  Injectable, UnauthorizedException, ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserOutput } from '../users/dto/user.output';
import { TokenService } from './token.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthOutput } from './dto/auth.output';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  // ── Register ──────────────────────────────────────────────────────────────
  async register(dto: RegisterInput): Promise<{ auth: AuthOutput; refreshToken: string }> {
    // Check for existing email before attempting to create.
    // We do this explicitly rather than relying on the MongoDB duplicate key error
    // so we can return a friendlier error message. The GlobalExceptionFilter handles
    // the MongoError 11000 as a fallback, but this path gives us more control.
    const exists = await this.userModel.exists({ email: dto.email.toLowerCase() });
    if (exists) {
      throw new ConflictException('An account with this email address already exists.');
    }

    // Password hashing happens in the UserSchema pre-save hook — we pass the
    // plaintext here and the hook hashes it transparently.
    const newUser = await this.userModel.create({
      email: dto.email.toLowerCase(),
      displayName: dto.displayName,
      password: dto.password,
      lastLoginAt: new Date(),
    });

    return this.buildAuthResponse(newUser);
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(
    dto: LoginInput,
    ipAddress?: string,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    // select('+password') explicitly fetches the password field which has
    // `select: false` on the schema. Never remove this — without it, the
    // returned document will have password: undefined and bcrypt.compare
    // will always return false, silently breaking authentication.
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+password')
      .exec();

    // IMPORTANT: We check the password even if the user doesn't exist.
    // A dummy compare prevents timing attacks where an attacker can detect
    // whether an email is registered based on response time differences
    // (no user → instant return vs. user exists → bcrypt delay).
    const dummyHash = '$2b$12$invalidhashpaddingtomatch.the.bcrypt.output.format';
    const passwordHash = user?.password ?? dummyHash;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !isPasswordValid) {
      // Deliberately vague: don't confirm whether the email exists
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated. Please contact support.');
    }

    // Update last login metadata — fire and forget, not on the critical path
    this.userModel.findByIdAndUpdate(user._id, {
      $set: { lastLoginAt: new Date(), lastLoginIp: ipAddress },
    }).exec().catch(() => {});

    return this.buildAuthResponse(user);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  // Revokes all refresh tokens for the user. This means logging out on
  // one device logs out everywhere — "nuclear logout". For per-device logout,
  // you'd pass the specific refresh token and only revoke that one token.
  async logout(userId: string): Promise<void> {
    await this.tokenService.revokeAllTokens(userId);
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  async refresh(rawRefreshToken: string): Promise<{
    auth: Omit<AuthOutput, 'user'> & { user?: UserOutput };
    refreshToken: string;
  }> {
    const { accessToken, refreshToken, userId } =
      await this.tokenService.rotateRefreshToken(rawRefreshToken);

    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const expiresAt = this.parseExpiresIn(expiresIn);

    return {
      auth: {
        accessToken,
        accessTokenExpiresAt: expiresAt,
      } as any,
      refreshToken,
    };
  }

  // ── Shared Response Builder ───────────────────────────────────────────────
  // Both register and login return the same shape. This factory method ensures
  // they're always consistent. Any future auth method (OAuth, magic link, etc.)
  // should call this too.
  private async buildAuthResponse(
    user: UserDocument,
  ): Promise<{ auth: AuthOutput; refreshToken: string }> {
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(user._id.toString());

    const expiresIn = this.config.get<string>('jwt.expiresIn') ?? '15m';
    const accessTokenExpiresAt = this.parseExpiresIn(expiresIn);

    const userOutput = plainToInstance(UserOutput, user.toObject(), {
      excludeExtraneousValues: true,
    });

    const auth: AuthOutput = { accessToken, user: userOutput, accessTokenExpiresAt };
    return { auth, refreshToken };
  }

  // Converts a JWT expiry string like '15m' or '7d' into an absolute Date.
  // The client uses this to schedule proactive token refresh before expiry.
  private parseExpiresIn(expiresIn: string): Date {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(Date.now() + 15 * 60 * 1000); // default 15m

    const [, amount, unit] = match;
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + parseInt(amount) * multipliers[unit]);
  }
}