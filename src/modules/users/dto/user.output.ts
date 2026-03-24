import { Exclude, Expose, Transform } from 'class-transformer';
import { ObjectType, Field, ID } from '@nestjs/graphql';

// @ObjectType() makes this both a GraphQL type AND a serialization target.
// It's the single source of truth for "what a User looks like to the outside world."
@ObjectType('User') // The string argument is the GraphQL type name
@Exclude() // Start by EXCLUDING everything — this is safer than @Expose-ing everything
export class UserOutput {
  @Field(() => ID)
  @Expose()
  // MongoDB stores _id as an ObjectId. We transform it to a plain string
  // so clients receive a consistent, serializable ID format.
  @Transform(({ obj }) => obj._id?.toString() ?? obj.id)
  id!: string;

  @Field()
  @Expose()
  email!: string;

  @Field()
  @Expose()
  displayName!: string;

  @Field(() => [String])
  @Expose()
  roles!: string[];

  @Field()
  @Expose()
  isEmailVerified!: boolean;

  @Field()
  @Expose()
  isActive!: boolean;

  @Field({ nullable: true })
  @Expose()
  lastLoginAt?: Date;

  @Field()
  @Expose()
  createdAt!: Date;

  @Field()
  @Expose()
  updatedAt!: Date;

  // password, refreshTokens, passwordResetToken, etc. are all excluded
  // by the class-level @Exclude() decorator — they simply won't appear
  // in any serialized response, even if they exist on the plain object.
}