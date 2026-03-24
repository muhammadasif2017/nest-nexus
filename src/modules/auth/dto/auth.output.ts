import { ObjectType, Field } from '@nestjs/graphql';
import { Expose, Exclude } from 'class-transformer';
import { UserOutput } from '../../users/dto/user.output';

// This is the shape returned by login and register mutations.
// The access token goes in the response body.
// The refresh token goes in an HttpOnly cookie (set via the resolver, not here).
// We NEVER return the refresh token in the response body.
@ObjectType()
@Exclude()
export class AuthOutput {
  @Field()
  @Expose()
  // Short-lived JWT: the client stores this in memory (NOT localStorage).
  // localStorage is vulnerable to XSS; memory storage means the token is
  // lost on page refresh, but that's fine because the refresh token in the
  // HttpOnly cookie will silently issue a new one.
  accessToken!: string;

  @Field(() => UserOutput)
  @Expose()
  user!: UserOutput;

  // accessTokenExpiresAt: so the client knows when to proactively refresh
  // before the 401 hits, improving UX.
  @Field()
  @Expose()
  accessTokenExpiresAt!: Date;
}