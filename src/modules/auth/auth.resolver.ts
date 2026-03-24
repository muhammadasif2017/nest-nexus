import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthOutput } from './dto/auth.output';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';

// The GQL context gives us access to the raw Express req/res objects.
// We need res to set the HttpOnly refresh token cookie — there's no
// other way to set a cookie from within a GraphQL resolver.
interface GqlContext {
  req: Request;
  res: Response;
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class AuthResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  // ── Register ──────────────────────────────────────────────────────────────
  // The 'strict' throttle profile: max 5 attempts per 10 minutes.
  // This is critical — registration is expensive (bcrypt) and a target for
  // account enumeration attacks and spam account creation.
  @Mutation(() => AuthOutput)
  @Public()
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  async register(
    @Args('input') input: RegisterInput,
    @Context() { res }: GqlContext,
  ): Promise<AuthOutput> {
    const { auth, refreshToken } = await this.authService.register(input);
    this.setRefreshTokenCookie(res, refreshToken);
    return auth;
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  @Mutation(() => AuthOutput)
  @Public()
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  async login(
    @Args('input') input: LoginInput,
    @Context() { req, res }: GqlContext,
  ): Promise<AuthOutput> {
    const { auth, refreshToken } = await this.authService.login(
      input,
      req.ip, // Pass IP for audit logging
    );
    this.setRefreshTokenCookie(res, refreshToken);
    return auth;
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  // The client calls this mutation proactively (before the access token expires)
  // or reactively (after receiving a 401). The refresh token is read from the
  // HttpOnly cookie — the client never touches it directly, which is the point.
  @Mutation(() => AuthOutput)
  @Public()
  async refreshTokens(
    @Context() { req, res }: GqlContext,
  ): Promise<Omit<AuthOutput, 'user'>> {
    const rawRefreshToken = req.cookies?.['refresh_token'];
    if (!rawRefreshToken) {
      // Throwing here goes through our GlobalExceptionFilter,
      // which formats it as a proper GraphQL error with UNAUTHENTICATED code.
      throw new Error('No refresh token provided.');
    }

    const { auth, refreshToken } = await this.authService.refresh(rawRefreshToken);
    // Rotate the cookie: clear the old one by overwriting with the new token.
    this.setRefreshTokenCookie(res, refreshToken);
    return auth;
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  @Mutation(() => Boolean)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Context() { res }: GqlContext,
  ): Promise<boolean> {
    await this.authService.logout(user.sub);

    // Clear the refresh token cookie. Setting maxAge: 0 immediately expires it.
    // The path must match exactly what was used when setting it.
    res.clearCookie('refresh_token', this.tokenService.getRefreshTokenCookieOptions());
    return true;
  }

  // ── Cookie Helper ─────────────────────────────────────────────────────────
  // Centralizing cookie setting here means all auth mutations set the cookie
  // identically. It's also a natural place to add cookie versioning in future.
  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refresh_token', token, this.tokenService.getRefreshTokenCookieOptions());
  }
}