import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

export interface OAuthProfile {
  provider: string;
  providerId: string;
  email?: string;
  displayName: string;
  avatar?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('oauth.googleClientId') ?? 'GOOGLE_NOT_CONFIGURED',
      clientSecret: config.get<string>('oauth.googleClientSecret') ?? 'GOOGLE_NOT_CONFIGURED',
      callbackURL: config.get<string>('oauth.googleCallbackUrl'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      displayName: string;
      emails?: Array<{ value: string }>;
      photos?: Array<{ value: string }>;
    },
    done: VerifyCallback,
  ): void {
    done(null, {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
      avatar: profile.photos?.[0]?.value,
    } satisfies OAuthProfile);
  }
}
