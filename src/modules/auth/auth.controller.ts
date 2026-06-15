import {
  Controller, Post, Body, Req, Res, HttpCode, HttpStatus,
  UseGuards, Get,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiCookieAuth, ApiBody,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { AuthOutput } from './dto/auth.output';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';

// JWT and session flows share the same base URL intentionally —
// clients choose their auth mechanism by which endpoint they call,
// not by a different URL prefix. This keeps the URL surface minimal.
@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
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
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
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
    res.cookie('refresh_token', refreshToken, this.authService['tokenService'].getRefreshTokenCookieOptions());
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
}