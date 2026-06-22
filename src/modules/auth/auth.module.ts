import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

import { OAuthController } from './oauth/oauth.controller';
import { GoogleStrategy } from './oauth/strategies/google.strategy';
import { GithubStrategy } from './oauth/strategies/github.strategy';
import { MicrosoftStrategy } from './oauth/strategies/microsoft.strategy';

import { TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorService } from './two-factor/two-factor.service';

import { MagicLinkController } from './magic-link/magic-link.controller';
import { MagicLinkService } from './magic-link/magic-link.service';

import { ApiKeyController } from './api-key/api-key.controller';
import { ApiKeyService } from './api-key/api-key.service';

import { WebauthnController } from './webauthn/webauthn.controller';
import { WebauthnService } from './webauthn/webauthn.service';

import { QueuesModule } from '../../core/queues/queues.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') as any },
      }),
    }),
    QueuesModule, // provides QUEUE_EMAIL for MagicLinkService
  ],
  providers: [
    AuthService,
    TokenService,
    TwoFactorService,
    MagicLinkService,
    ApiKeyService,
    WebauthnService,
    JwtStrategy,
    JwtRefreshStrategy,
    GoogleStrategy,
    GithubStrategy,
    MicrosoftStrategy,
  ],
  controllers: [
    AuthController,
    OAuthController,
    TwoFactorController,
    MagicLinkController,
    ApiKeyController,
    WebauthnController,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
