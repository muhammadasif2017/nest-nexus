import { ApiProperty } from '@nestjs/swagger';
import { Expose, Exclude } from 'class-transformer';
import { UserOutput } from '../../users/dto/user.output';

// This is the shape returned by the login and register endpoints.
// The access token goes in the response body.
// The refresh token goes in an HttpOnly cookie (set via the controller, not here).
// We NEVER return the refresh token in the response body.
@Exclude()
export class AuthOutput {
  @ApiProperty({ description: 'Short-lived JWT access token. Store in memory, not localStorage.' })
  @Expose()
  // Store in memory (not localStorage) — localStorage is vulnerable to XSS; the
  // HttpOnly refresh cookie silently reissues this token on page reload.
  accessToken!: string;

  @ApiProperty({ type: () => UserOutput, required: false })
  @Expose()
  user?: UserOutput;

  @ApiProperty({ description: 'ISO timestamp when the access token expires.' })
  @Expose()
  accessTokenExpiresAt!: Date;

  // True when 2FA is enabled and the token has scope='two_factor_pending'.
  // Client must call POST /auth/2fa/verify with the TOTP code to receive a full token.
  @ApiProperty({ required: false, description: 'True if 2FA verification is still required.' })
  @Expose()
  isTwoFactorPending?: boolean;
}
