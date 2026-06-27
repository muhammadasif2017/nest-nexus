import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Get,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiBody,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { AuthOutput } from './dto/auth.output';
import { DeviceSessionOutput } from './dto/device-session.output';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates account and returns JWT access token. Refresh token set as HttpOnly cookie.',
  })
  @ApiBody({ type: RegisterInput })
  @ApiResponse({ status: 201, description: 'Registration successful.', type: AuthOutput })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 409, description: 'Email already in use.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async register(
    @Body() dto: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // passthrough: true on @Res() means NestJS still handles the response serialization
    const { auth, refreshToken } = await this.authService.register(dto, req.headers['user-agent']);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Login with email + password',
    description: 'Returns JWT access token. Refresh token set as HttpOnly cookie.',
  })
  @ApiBody({ type: LoginInput })
  @ApiResponse({ status: 200, description: 'Login successful.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async login(
    @Body() dto: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { auth, refreshToken } = await this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
    if (refreshToken) {
      res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    }
    return auth;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh token',
    description:
      'Reads refresh token from HttpOnly cookie, issues new token pair. Old refresh token is revoked.',
  })
  @ApiCookieAuth('refresh-token')
  @ApiResponse({ status: 200, description: 'Tokens rotated.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Missing or invalid refresh token.' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.['refresh_token'];
    if (!rawToken) throw new UnauthorizedException('No refresh token found.');
    const { auth, refreshToken } = await this.authService.refresh(rawToken);
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout',
    description: 'Revokes all refresh tokens for the authenticated user and clears the cookie.',
  })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async logout(@CurrentUser() user: JwtPayload, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user.sub);
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    // 204 No Content — nothing to return after logout
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns the JWT payload of the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Current user payload.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return user;
  }

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List active device sessions',
    description:
      'Returns one entry per device with an active (non-expired, non-revoked) refresh token.',
  })
  @ApiResponse({ status: 200, description: 'Active device sessions.', type: [DeviceSessionOutput] })
  async listSessions(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ): Promise<DeviceSessionOutput[]> {
    const currentDeviceId = await this.tokenService.getCurrentDeviceId(
      user.sub,
      req.cookies?.['refresh_token'],
    );
    return this.tokenService.listDeviceSessions(user.sub, currentDeviceId);
  }

  @Delete('sessions/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Revoke a device session',
    description: 'Revokes all refresh tokens for the given deviceId, signing that device out.',
  })
  @ApiResponse({ status: 204, description: 'Device session revoked.' })
  async revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.tokenService.revokeDeviceSession(user.sub, deviceId);
  }
}
