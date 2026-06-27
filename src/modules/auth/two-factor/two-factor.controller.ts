import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import { TwoFactorService } from './two-factor.service';
import { AuthOutput } from '../dto/auth.output';
import { TwoFactorCodeInput } from './dto/two-factor-code.input';
import { Throttle } from '@nestjs/throttler';
import { AllowPending2FA } from '../../../common/decorators/allow-pending-2fa.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Post('setup')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Generate TOTP secret + QR code',
    description:
      'Returns secret and data URL for a QR code to scan with an authenticator app. Call enable to activate.',
  })
  @ApiResponse({ status: 200, description: 'Setup data returned.' })
  async setup(@CurrentUser() user: JwtPayload) {
    return this.twoFactorService.setup(user.sub);
  }

  @Post('enable')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enable 2FA (verify TOTP code)',
    description: 'Returns 10 single-use backup codes. Save them — they are shown only once.',
  })
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 200, description: 'Backup codes returned.' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code.' })
  async enable(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeInput) {
    const backupCodes = await this.twoFactorService.enable(user.sub, dto.code);
    return { backupCodes };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Disable 2FA',
    description: 'Requires a valid TOTP code to prevent accidental or unauthorized disabling.',
  })
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 204, description: '2FA disabled.' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code.' })
  async disable(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeInput) {
    await this.twoFactorService.disable(user.sub, dto.code);
  }

  @Post('verify')
  @Throttle({ strict: { limit: 3, ttl: 600_000 } })
  @AllowPending2FA()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete 2FA login',
    description:
      'Exchanges a pending-2FA access token + TOTP code for a full access token. Refresh token set as HttpOnly cookie.',
  })
  @ApiBearerAuth('access-token')
  @ApiBody({ type: TwoFactorCodeInput })
  @ApiResponse({ status: 200, description: 'Full access token issued.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid TOTP or backup code.' })
  async verify(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorCodeInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const isValid = await this.twoFactorService.verify(user.sub, dto.code);
    if (!isValid) throw new UnauthorizedException('Invalid 2FA code.');

    const { auth, refreshToken } = await this.authService.issueTokens(
      user.sub,
      req.headers['user-agent'],
    );
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }
}
