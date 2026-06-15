import { ObjectType, Field } from '@nestjs/graphql';
import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'Short-lived JWT access token. Store in memory, not localStorage.' })
  @Expose()
  accessToken!: string;

  @Field(() => UserOutput)
  @ApiProperty({ type: () => UserOutput })
  @Expose()
  user!: UserOutput;

  @Field()
  @ApiProperty({ description: 'ISO timestamp when the access token expires.' })
  @Expose()
  accessTokenExpiresAt!: Date;
}