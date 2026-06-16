import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from './google.strategy';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('oauth.githubClientId') ?? 'GITHUB_NOT_CONFIGURED',
      clientSecret: config.get<string>('oauth.githubClientSecret') ?? 'GITHUB_NOT_CONFIGURED',
      callbackURL: config.get<string>('oauth.githubCallbackUrl')!,
      scope: ['user:email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      username?: string;
      displayName?: string;
      emails?: Array<{ value: string }>;
      photos?: Array<{ value: string }>;
    },
    done: (err: Error | null, user?: OAuthProfile) => void,
  ): void {
    done(null, {
      provider: 'github',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName ?? profile.username ?? 'GitHub User',
      avatar: profile.photos?.[0]?.value,
    });
  }
}
