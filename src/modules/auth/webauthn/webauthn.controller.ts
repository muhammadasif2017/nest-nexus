import { Controller, Post, Delete, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import { WebauthnService } from './webauthn.service';
import { AuthOutput } from '../dto/auth.output';
import { WebauthnRegisterVerifyInput } from './dto/webauthn-register-verify.input';
import { WebauthnLoginOptionsInput } from './dto/webauthn-login-options.input';
import { WebauthnLoginVerifyInput } from './dto/webauthn-login-verify.input';
import { WebauthnSignupOptionsInput } from './dto/webauthn-signup-options.input';
import { WebauthnSignupVerifyInput } from './dto/webauthn-signup-verify.input';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@ApiTags('auth')
@Controller('auth/webauthn')
export class WebauthnController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly webauthnService: WebauthnService,
  ) {}

  @Post('register/options')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Generate WebAuthn registration options for the current user' })
  async registerOptions(@CurrentUser() user: JwtPayload) {
    return this.webauthnService.registerOptions(user.sub, user.email);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Verify and store a new WebAuthn credential for the current user' })
  @ApiBody({ type: WebauthnRegisterVerifyInput })
  async registerVerify(@CurrentUser() user: JwtPayload, @Body() dto: WebauthnRegisterVerifyInput) {
    await this.webauthnService.registerVerify(user.sub, dto.response);
    return { message: 'Passkey registered.' };
  }

  @Post('login/options')
  @Public()
  @ApiOperation({ summary: 'Generate WebAuthn authentication options for login' })
  @ApiBody({ type: WebauthnLoginOptionsInput })
  async loginOptions(@Body() dto: WebauthnLoginOptionsInput) {
    return this.webauthnService.loginOptions(dto.email);
  }

  @Post('login/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a WebAuthn login assertion',
    description: 'Issues a full access/refresh token pair on success — no password needed.',
  })
  @ApiBody({ type: WebauthnLoginVerifyInput })
  @ApiResponse({ status: 200, description: 'Login successful.', type: AuthOutput })
  @ApiResponse({ status: 401, description: 'Invalid assertion or no passkey registered.' })
  async loginVerify(
    @Body() dto: WebauthnLoginVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const userId = await this.webauthnService.loginVerify(dto.email, dto.response);
    const { auth, refreshToken } = await this.authService.issueTokens(
      userId,
      req.headers['user-agent'],
    );
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }

  @Delete('credential')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Delete the current user's passkey" })
  @ApiResponse({ status: 204, description: 'Passkey deleted.' })
  @ApiResponse({ status: 404, description: 'No passkey registered for this account.' })
  async deleteCredential(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.webauthnService.deleteCredential(user.sub);
  }

  // ── Passkey-only signup — separate from register/options+verify above, which
  // require an existing JWT-authenticated user. These create a brand-new account.

  @Post('signup/options')
  @Public()
  @ApiOperation({ summary: 'Generate WebAuthn registration options for a brand-new account' })
  @ApiBody({ type: WebauthnSignupOptionsInput })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  async signupOptions(@Body() dto: WebauthnSignupOptionsInput) {
    return this.webauthnService.signupOptions(dto.email, dto.displayName);
  }

  @Post('signup/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify signup and create a new passkey-only account',
    description:
      'Creates a user with no password — the passkey is the only credential. ' +
      'Issues a full access/refresh token pair on success.',
  })
  @ApiBody({ type: WebauthnSignupVerifyInput })
  @ApiResponse({ status: 200, description: 'Account created and logged in.', type: AuthOutput })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  @ApiResponse({ status: 401, description: 'Invalid registration response.' })
  async signupVerify(
    @Body() dto: WebauthnSignupVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthOutput> {
    const userId = await this.webauthnService.signupVerify(dto.email, dto.response);
    const { auth, refreshToken } = await this.authService.issueTokens(
      userId,
      req.headers['user-agent'],
    );
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    return auth;
  }
}
