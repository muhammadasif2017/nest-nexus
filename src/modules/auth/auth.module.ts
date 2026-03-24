import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

import { User, UserSchema } from '../users/schemas/user.schema';

// We import UsersModule only for UsersService (for the DataLoader + lookups
// that the auth flow occasionally needs). We DON'T re-register the Mongoose
// model here — that's already done in UsersModule and we import it there.
// But since AuthService needs direct model access for credential checking,
// we register it here too (this is fine — Mongoose deduplicates registrations).
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    // forRootAsync reads the secret from the validated config rather than
    // hardcoding it. The JwtModule is used by TokenService to sign/verify tokens.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // We set a default secret and expiry here, but TokenService overrides
        // them per-call for access vs. refresh tokens — this is just a fallback.
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  providers: [
    AuthService,
    AuthResolver,
    TokenService,
    JwtStrategy,       // Registered as a Passport strategy via PassportModule
    JwtRefreshStrategy,
  ],
  controllers: [AuthController],
  // Export AuthService so other modules (e.g., a future OAuthModule) can
  // call login/register without duplicating logic.
  exports: [AuthService, TokenService],
})
export class AuthModule {}
