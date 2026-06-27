import { Injectable, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

const STATE_COOKIE = 'oauth_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function OAuthInitGuard(strategy: string) {
  @Injectable()
  class Guard extends AuthGuard(strategy) {
    @Inject(ConfigService)
    private readonly config!: ConfigService;

    getAuthenticateOptions(context: ExecutionContext) {
      const res = context.switchToHttp().getResponse<Response>();
      const state = crypto.randomBytes(32).toString('hex');
      const isProd = this.config.get<string>('app.nodeEnv') === 'production';
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax' as const,
        maxAge: STATE_MAX_AGE_MS,
        path: '/',
      });
      return { state };
    }
  }
  return Guard;
}

function OAuthCallbackGuard(strategy: string) {
  @Injectable()
  class Guard extends AuthGuard(strategy) {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest<Request>();
      const res = context.switchToHttp().getResponse<Response>();

      const cookieState = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
      const queryState = req.query?.state as string | undefined;

      res.clearCookie(STATE_COOKIE, { path: '/' });

      if (!cookieState || !queryState || cookieState.length !== queryState.length) {
        throw new UnauthorizedException('OAuth CSRF check failed');
      }

      if (
        !crypto.timingSafeEqual(Buffer.from(cookieState, 'utf8'), Buffer.from(queryState, 'utf8'))
      ) {
        throw new UnauthorizedException('OAuth CSRF check failed');
      }

      return super.canActivate(context);
    }
  }
  return Guard;
}

export const GoogleOAuthInitGuard = OAuthInitGuard('google');
export const GithubOAuthInitGuard = OAuthInitGuard('github');
export const MicrosoftOAuthInitGuard = OAuthInitGuard('microsoft');

export const GoogleOAuthCallbackGuard = OAuthCallbackGuard('google');
export const GithubOAuthCallbackGuard = OAuthCallbackGuard('github');
export const MicrosoftOAuthCallbackGuard = OAuthCallbackGuard('microsoft');
