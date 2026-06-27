import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import { Public } from '../../../common/decorators/public.decorator';
import { OAuthProfile } from './strategies/google.strategy';
import {
  GoogleOAuthInitGuard,
  GithubOAuthInitGuard,
  MicrosoftOAuthInitGuard,
  GoogleOAuthCallbackGuard,
  GithubOAuthCallbackGuard,
  MicrosoftOAuthCallbackGuard,
} from '../../../common/guards/oauth-csrf.guard';

@ApiTags('auth')
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
  ) {}

  // ── OAuth2 — Google ──────────────────────────────────────────────────────────

  @Get('google')
  @Public()
  @UseGuards(GoogleOAuthInitGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth2 flow' })
  googleAuth() {
    // Passport redirects to Google automatically — no body needed
  }

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleOAuthCallbackGuard)
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handleOAuthCallback(req, res);
  }

  // ── OAuth2 — GitHub ──────────────────────────────────────────────────────────

  @Get('github')
  @Public()
  @UseGuards(GithubOAuthInitGuard)
  @ApiOperation({ summary: 'Initiate GitHub OAuth2 flow' })
  githubAuth() {}

  @Get('github/callback')
  @Public()
  @UseGuards(GithubOAuthCallbackGuard)
  @ApiOperation({ summary: 'GitHub OAuth2 callback' })
  async githubCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handleOAuthCallback(req, res);
  }

  // ── OAuth2 — Microsoft ───────────────────────────────────────────────────────

  @Get('microsoft')
  @Public()
  @UseGuards(MicrosoftOAuthInitGuard)
  @ApiOperation({ summary: 'Initiate Microsoft OAuth2 flow' })
  microsoftAuth() {}

  @Get('microsoft/callback')
  @Public()
  @UseGuards(MicrosoftOAuthCallbackGuard)
  @ApiOperation({ summary: 'Microsoft OAuth2 callback' })
  async microsoftCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handleOAuthCallback(req, res);
  }

  // Fragment (#) is not sent to the server or logged by proxies — safer than a query param.
  private async handleOAuthCallback(req: Request, res: Response): Promise<void> {
    const { auth, refreshToken } = await this.authService.oauthLogin(
      req.user as OAuthProfile,
      req.headers['user-agent'],
    );
    res.cookie('refresh_token', refreshToken, this.tokenService.getRefreshTokenCookieOptions());
    const clientOrigin = this.config.get<string>('app.clientOrigin');
    res.redirect(`${clientOrigin}/oauth/success#token=${auth.accessToken}`);
  }
}
