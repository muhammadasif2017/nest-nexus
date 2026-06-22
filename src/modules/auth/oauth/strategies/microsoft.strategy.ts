import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from './google.strategy';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('oauth.microsoftClientId') ?? 'MICROSOFT_NOT_CONFIGURED',
      clientSecret: config.get<string>('oauth.microsoftClientSecret') ?? 'MICROSOFT_NOT_CONFIGURED',
      callbackURL: config.get<string>('oauth.microsoftCallbackUrl')!,
      scope: ['user.read'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      displayName?: string;
      emails?: Array<{ value: string }>;
    },
    done: (err: Error | null, user?: OAuthProfile) => void,
  ): void {
    done(null, {
      provider: 'microsoft',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName ?? 'Microsoft User',
      avatar: undefined,
    });
  }
}
