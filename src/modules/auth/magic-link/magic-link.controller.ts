import { Controller, Post, Get, Body, Query, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import { MagicLinkService } from './magic-link.service';
import { AuthOutput } from '../dto/auth.output';
import { MagicLinkSendInput, MagicLinkVerifyInput } from './dto/magic-link.input';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('auth')
@Controller('auth/magic-link')
export class MagicLinkController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  @Post('send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 3, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Send magic login link',
    description:
      'Emails a one-time login link (15 min TTL). Always returns 200 — does not reveal whether the email exists.',
  })
  @ApiBody({ type: MagicLinkSendInput })
  @ApiResponse({ status: 200, description: 'Email sent (if account exists).' })
  async send(@Body() dto: MagicLinkSendInput) {
    await this.magicLinkService.send(dto.email);
    return { message: 'If an account with this email exists, a login link has been sent.' };
  }

  @Get('verify')
  @Public()
  @ApiOperation({
    summary: 'Verify magic link token',
    description:
      'Single-use. Issues a full session on success. Refresh token set as HttpOnly cookie.',
  })
  @ApiQuery({ name: 'token', description: 'Token from the magic link URL' })
  @ApiResponse({ status: 200, description: 'Login successful.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid or expired token.' })
  async verify(
    @Query() dto: MagicLinkVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const userId = await this.magicLinkService.verify(dto.token);
    const { auth, refreshToken } = await this.authService.issueTokens(
      userId,
      req.headers['user-agent'],
    );
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }
}
