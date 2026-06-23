import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { SessionLoginInput } from './dto/session-login.input';
import { SessionGuard } from './session-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('session-auth')
@Controller('auth/session')
export class SessionAuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('csrf-token')
  @Public()
  @ApiOperation({
    summary: 'Get CSRF token',
    description:
      'Sets the XSRF-TOKEN cookie and returns the token. Call before any session-auth ' +
      'POST request — the double-submit pattern requires a token in hand before login.',
  })
  @ApiResponse({ status: 200, description: 'CSRF token issued.' })
  async getCsrfToken(@Req() req: Request): Promise<{ csrfToken: string }> {
    const csrfToken = req.csrfToken!();

    // The CSRF HMAC binds to req.session.id, but saveUninitialized:false means an
    // anonymous session is never persisted — without this, every request gets a
    // fresh in-memory session id, so the token minted here would no longer match
    // by the time the client's next request (e.g. login) arrives.
    (req.session as any).csrfIssued = true;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return { csrfToken };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Session-based login',
    description: 'For traditional web clients. Sets HttpOnly session cookie — no tokens returned.',
  })
  @ApiBody({ type: SessionLoginInput })
  @ApiResponse({ status: 200, description: 'Session created.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (5 per 10 min).' })
  async login(
    @Body() dto: SessionLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { auth } = await this.authService.login(dto, req.ip, req.headers['user-agent']);

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

  @Post('logout')
  @Public()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Session-based logout',
    description:
      'Destroys the server-side session. @Public() here only opts out of the global ' +
      'JWT guard (this route uses the session cookie, not a Bearer token) — SessionGuard ' +
      'still enforces real authentication.',
  })
  @ApiResponse({ status: 204, description: 'Session destroyed.' })
  @ApiResponse({ status: 401, description: 'No active session.' })
  async logout(@Req() req: Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
