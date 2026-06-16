import {
  Controller, Post, Body, Req, Res, HttpCode, HttpStatus,
  UseGuards, Get, Query, UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiCookieAuth, ApiBody, ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { MagicLinkService } from './magic-link.service';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { AuthOutput } from './dto/auth.output';
import { TwoFactorCodeInput, MagicLinkSendInput, MagicLinkVerifyInput } from './dto/two-factor.input';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AllowPending2FA } from '../../common/decorators/allow-pending-2fa.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';
import { OAuthProfile } from './strategies/google.strategy';

// JWT and session flows share the same base URL intentionally —
// clients choose their auth mechanism by which endpoint they call,
// not by a different URL prefix. This keeps the URL surface minimal.
@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly twoFactorService: TwoFactorService,
    private readonly magicLinkService: MagicLinkService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Register a new user', description: 'Creates account and returns JWT access token. Refresh token set as HttpOnly cookie.' })
  @ApiBody({ type: RegisterInput })
  @ApiResponse({ status: 201, description: 'Registration successful.', type: AuthOutput })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 409, description: 'Email already in use.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async register(
    @Body() dto: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    // passthrough: true on @Res() means NestJS still handles the response
    // serialization — we're just adding the cookie as a side effect.
    const { auth, refreshToken } = await this.authService.register(dto);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth; // NestJS serializes this via the global ClassSerializerInterceptor
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Login with email + password', description: 'Returns JWT access token. Refresh token set as HttpOnly cookie.' })
  @ApiBody({ type: LoginInput })
  @ApiResponse({ status: 200, description: 'Login successful.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async login(
    @Body() dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { auth, refreshToken } = await this.authService.login(dto, req.ip);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token', description: 'Reads refresh token from HttpOnly cookie, issues new token pair. Old refresh token is revoked.' })
  @ApiCookieAuth('refresh-token')
  @ApiResponse({ status: 200, description: 'Tokens rotated.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Missing or invalid refresh token.' })
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
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout', description: 'Revokes all refresh tokens for the authenticated user and clears the cookie.' })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    // 204 No Content — nothing to return after logout
  }

  @Post('session/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Session-based login', description: 'For traditional web clients. Sets HttpOnly session cookie — no tokens returned.' })
  @ApiBody({ type: LoginInput })
  @ApiResponse({ status: 200, description: 'Session created.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async sessionLogin(
    @Body() dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { auth } = await this.authService.login(dto, req.ip);

    if ((auth as any).isTwoFactorPending) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: 401,
        errorCode: 'TWO_FACTOR_REQUIRED',
        message: 'Two-factor authentication required. Use the JWT flow to complete 2FA.',
      });
    }

    // Regenerate the session ID after login — this prevents session fixation attacks,
    // where an attacker pre-sets a known session ID and waits for the victim to log in.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Store the user payload in the session. The session is persisted to PostgreSQL
    // via connect-pg-simple (configured in main.ts).
    (req.session as any).user = auth.user;
    (req.session as any).userId = auth.user!.id;

    // We don't return tokens here — the session cookie is the auth mechanism.
    return { message: 'Logged in successfully.', user: auth.user };
  }

  @Post('session/logout')
  @Public() // Session guard handles auth for this endpoint — no JWT required
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Session-based logout', description: 'Destroys the server-side session.' })
  @ApiResponse({ status: 204, description: 'Session destroyed.' })
  async sessionLogout(@Req() req: Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user', description: 'Returns the JWT payload of the authenticated user.' })
  @ApiResponse({ status: 200, description: 'Current user payload.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return user;
  }

  // ── OAuth2 — Google ──────────────────────────────────────────────────────────

  @Get('google')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth2 flow' })
  googleAuth() {
    // Passport redirects to Google automatically — no body needed
  }

  @Get('google/callback')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { auth, refreshToken } = await this.authService.oauthLogin(req.user as OAuthProfile);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    const clientOrigin = this.config.get<string>('app.clientOrigin');
        // Fragment (#) is not sent to the server or logged by proxies — safer than a query param.
    res.redirect(`${clientOrigin}/oauth/success#token=${auth.accessToken}`);
  }

  // ── OAuth2 — GitHub ──────────────────────────────────────────────────────────

  @Get('github')
  @Public()
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'Initiate GitHub OAuth2 flow' })
  githubAuth() {}

  @Get('github/callback')
  @Public()
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  async githubCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { auth, refreshToken } = await this.authService.oauthLogin(req.user as OAuthProfile);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    const clientOrigin = this.config.get<string>('app.clientOrigin');
        // Fragment (#) is not sent to the server or logged by proxies — safer than a query param.
    res.redirect(`${clientOrigin}/oauth/success#token=${auth.accessToken}`);
  }

  // ── 2FA TOTP ─────────────────────────────────────────────────────────────────

  @Post('2fa/setup')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Generate TOTP secret + QR code', description: 'Returns secret and data URL for a QR code to scan with an authenticator app. Call enable to activate.' })
  @ApiResponse({ status: 200, description: 'Setup data returned.' })
  async setup2fa(@CurrentUser() user: JwtPayload) {
    return this.twoFactorService.setup(user.sub);
  }

  @Post('2fa/enable')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable 2FA (verify TOTP code)', description: 'Returns 10 single-use backup codes. Save them — they are shown only once.' })
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 200, description: 'Backup codes returned.' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code.' })
  async enable2fa(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeInput) {
    const backupCodes = await this.twoFactorService.enable(user.sub, dto.code);
    return { backupCodes };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable 2FA', description: 'Requires a valid TOTP code to prevent accidental or unauthorized disabling.' })
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 204, description: '2FA disabled.' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code.' })
  async disable2fa(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeInput) {
    await this.twoFactorService.disable(user.sub, dto.code);
  }

  @Post('2fa/verify')
  @AllowPending2FA()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete 2FA login', description: 'Exchanges a pending-2FA access token + TOTP code for a full access token. Refresh token set as HttpOnly cookie.' })
  @ApiBearerAuth('access-token')
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 200, description: 'Full access token issued.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid TOTP or backup code.' })
  async verify2fa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorCodeInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const isValid = await this.twoFactorService.verify(user.sub, dto.code);
    if (!isValid) throw new UnauthorizedException('Invalid 2FA code.');

    const { auth, refreshToken } = await this.authService.issueTokens(user.sub);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  // ── Magic Links ──────────────────────────────────────────────────────────────

  @Post('magic-link/send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 3, ttl: 600_000 } })
  @ApiOperation({ summary: 'Send magic login link', description: 'Emails a one-time login link (15 min TTL). Always returns 200 — does not reveal whether the email exists.' })
  @ApiBody({ type: MagicLinkSendInput })
  @ApiResponse({ status: 200, description: 'Email sent (if account exists).' })
  async sendMagicLink(@Body() dto: MagicLinkSendInput) {
    await this.magicLinkService.send(dto.email);
    return { message: 'If an account with this email exists, a login link has been sent.' };
  }

  @Get('magic-link/verify')
  @Public()
  @ApiOperation({ summary: 'Verify magic link token', description: 'Single-use. Issues a full session on success. Refresh token set as HttpOnly cookie.' })
  @ApiQuery({ name: 'token', description: 'Token from the magic link URL' })
  @ApiResponse({ status: 200, description: 'Login successful.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid or expired token.' })
  async verifyMagicLink(
    @Query() dto: MagicLinkVerifyInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const userId = await this.magicLinkService.verify(dto.token);
    const { auth, refreshToken } = await this.authService.issueTokens(userId);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }
}