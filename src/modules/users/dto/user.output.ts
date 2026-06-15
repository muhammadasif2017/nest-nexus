import { Exclude, Expose, Transform } from 'class-transformer';
import { ObjectType, Field, ID } from '@nestjs/graphql';
import { ApiProperty } from '@nestjs/swagger';

// @ObjectType() makes this both a GraphQL type AND a serialization target.
// It's the single source of truth for "what a User looks like to the outside world."
@ObjectType('User') // The string argument is the GraphQL type name
@Exclude() // Start by EXCLUDING everything — this is safer than @Expose-ing everything
export class UserOutput {
  @Field(() => ID)
  @ApiProperty({ example: '64a1f2b3c4d5e6f7a8b9c0d1' })
  @Expose()
  // Mongoose returns _id as ObjectId — transform to plain string for a consistent serializable ID.
  @Transform(({ obj }) => obj._id?.toString() ?? obj.id)
  id!: string;

  @Field()
  @ApiProperty({ example: 'user@example.com' })
  @Expose()
  email!: string;

  @Field()
  @ApiProperty({ example: 'John Doe' })
  @Expose()
  displayName!: string;

  @Field(() => [String])
  @ApiProperty({ example: ['user'], type: [String] })
  @Expose()
  roles!: string[];

  @Field()
  @ApiProperty({ example: false })
  @Expose()
  isEmailVerified!: boolean;

  @Field()
  @ApiProperty({ example: true })
  @Expose()
  isActive!: boolean;

  @Field({ nullable: true })
  @ApiProperty({ required: false, nullable: true })
  @Expose()
  lastLoginAt?: Date;

  @Field()
  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @Field()
  @ApiProperty()
  @Expose()
  updatedAt!: Date;

  // password, refreshTokens, passwordResetToken, etc. are all excluded
  // by the class-level @Exclude() decorator — they simply won't appear
  // in any serialized response, even if they exist on the plain object.
}