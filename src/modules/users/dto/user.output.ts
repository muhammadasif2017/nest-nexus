import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// The single source of truth for "what a User looks like to the outside world."
// SerializeInterceptor (ClassSerializerInterceptor) uses these decorators to
// strip anything not explicitly @Expose()'d from REST responses.
@Exclude() // Start by EXCLUDING everything — this is safer than @Expose-ing everything
export class UserOutput {
  @ApiProperty({ example: 'cuid2-or-uuid-string' })
  @Expose()
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  @Expose()
  email!: string;

  @ApiProperty({ example: 'John Doe' })
  @Expose()
  displayName!: string;

  @ApiProperty({ example: ['user'], type: [String] })
  @Expose()
  roles!: string[];

  @ApiProperty({ example: false })
  @Expose()
  isEmailVerified!: boolean;

  @ApiProperty({ example: true })
  @Expose()
  isActive!: boolean;

  @ApiProperty({ required: false, nullable: true })
  @Expose()
  avatarUrl?: string;

  @ApiProperty({ required: false, nullable: true })
  @Expose()
  lastLoginAt?: Date;

  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  updatedAt!: Date;

  // password, refreshTokens, passwordResetToken, etc. are all excluded
  // by the class-level @Exclude() decorator — they simply won't appear
  // in any serialized response, even if they exist on the plain object.
}
