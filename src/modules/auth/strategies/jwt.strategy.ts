import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';

export interface JwtPayload {
  sub: string;   // Subject: the user's MongoDB _id (standard JWT claim)
  email: string;
  roles: string[];
  iat?: number;  // Issued at (set automatically by jwt.sign)
  exp?: number;  // Expiry (set automatically)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      // Extract the JWT from the Authorization: Bearer <token> header.
      // This is the standard for stateless API authentication.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // If true, expired tokens are silently accepted — NEVER do this.
      ignoreExpiration: false,

      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  // validate() is called ONLY after the JWT signature is verified and
  // the token hasn't expired. The decoded payload is passed in.
  // Whatever this method returns gets attached to req.user.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // We do a lightweight DB check here to handle token revocation scenarios:
    // if a user is deactivated after they logged in, their token should stop working.
    // Note: for high-traffic APIs, consider caching this check in Redis instead.
    const user = await this.userModel.findById(payload.sub).select('isActive').lean();

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found.');
    }

    // Return the payload (not the full DB document) — this is what lands in req.user.
    // We deliberately keep req.user lightweight. If a handler needs more user data,
    // it should fetch it explicitly with the userId.
    return payload;
  }
}