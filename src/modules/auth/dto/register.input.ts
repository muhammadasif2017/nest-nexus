import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail, IsString, MinLength, MaxLength, Matches,
} from 'class-validator';

@InputType()
export class RegisterInput {
  @Field()
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email!: string;

  @Field()
  @IsString()
  @MinLength(2) @MaxLength(100)
  displayName!: string;

  @Field()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password cannot exceed 72 characters (bcrypt limit).' })
  // Require at least one uppercase, one lowercase, one digit, one special char.
  // This regex is enforced at the DTO layer so it never reaches the service.
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password must contain uppercase, lowercase, number, and special character.',
  })
  password!: string;
}