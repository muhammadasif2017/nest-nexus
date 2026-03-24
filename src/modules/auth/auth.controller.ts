import {
  Controller, Post, Body, Req, Res, HttpCode, HttpStatus,
  UseGuards, Get,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';

// Version(1) ensures this maps to /api/v1/auth/*
// The session-based flow is the same base URL as the JWT flow intentionally —
// clients choose their flow by which endpoint they call.
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── JWT: Register (returns tokens) ───────────────────────────────────────
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  async register(
    @Body() dto: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    // passthrough: true on @Res() means NestJS still handles the response
    // serialization — we're just adding the cookie as a side effect.
    const { auth, refreshToken } = await this.authService.register(dto);
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
    return auth; // NestJS serializes this via the global ClassSerializerInterceptor
  }

  // ── JWT: Login (returns tokens + sets cookie) ────────────────────────────
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  async login(
    @Body() dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { auth, refreshToken } = await this.authService.login(dto, req.ip);
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
    return auth;
  }

  // ── JWT: Refresh ─────────────────────────────────────────────────────────
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies?.['refresh_token'];
    if (!rawToken) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED',
        message: 'No refresh token found.',
      });
    }
    const { auth, refreshToken } = await this.authService.refresh(rawToken);
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
    return auth;
  }

  // ── JWT: Logout ───────────────────────────────────────────────────────────
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    // 204 No Content — nothing to return after logout
  }

  // ── Session: Login (creates server-side session) ──────────────────────────
  // This endpoint is for traditional web clients. The session ID is stored in
  // an HttpOnly cookie managed entirely by express-session. The client doesn't
  // receive any tokens — the session cookie IS the credential.
  @Post('session/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  async sessionLogin(
    @Body() dto: LoginInput,
    @Req() req: Request,
  ) {
    const { auth } = await this.authService.login(dto, req.ip);

    // Regenerate the session ID after login — this prevents session fixation attacks,
    // where an attacker pre-sets a known session ID and waits for the victim to log in.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Store the user payload in the session. The session is persisted to MongoDB
    // via connect-mongo (configured in main.ts).
    (req.session as any).user = auth.user;
    (req.session as any).userId = auth.user.id;

    // We don't return tokens here — the session cookie is the auth mechanism.
    return { message: 'Logged in successfully.', user: auth.user };
  }

  // ── Session: Logout ───────────────────────────────────────────────────────
  @Post('session/logout')
  @Public() // Session guard handles this separately
  @HttpCode(HttpStatus.NO_CONTENT)
  async sessionLogout(@Req() req: Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Authenticated: Get current user ──────────────────────────────────────
  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return user;
  }
}