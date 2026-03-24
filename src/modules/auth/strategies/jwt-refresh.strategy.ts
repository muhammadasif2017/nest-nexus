import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RefreshTokenPayload } from '../token.service';

// A second Passport strategy, named 'jwt-refresh', specifically for the
// refresh endpoint. It reads the token from the HttpOnly cookie (not the
// Authorization header, since the client doesn't have access to the cookie value).
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      // Read the token from the refresh_token cookie, not the header.
      // fromExtractors accepts an array of extractor functions tried in order.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => request?.cookies?.['refresh_token'] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret'),
      // passReqToCallback: true lets us access the raw token in validate(),
      // which we need to do the bcrypt comparison against stored hashes.
      passReqToCallback: true,
    });
  }

  // validate() only runs after the JWT signature check passes.
  // We return the payload here; the actual bcrypt verification and rotation
  // happen in TokenService.rotateRefreshToken() called from AuthService.
  async validate(request: Request, payload: RefreshTokenPayload) {
    const rawToken = request.cookies?.['refresh_token'];
    if (!rawToken) throw new UnauthorizedException();
    // Attach the raw token to the payload so the guard/service can use it
    return { ...payload, rawToken };
  }
}