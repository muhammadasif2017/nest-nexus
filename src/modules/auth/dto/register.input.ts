import { InputType, Field } from '@nestjs/graphql';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail, IsString, MinLength, MaxLength, Matches,
} from 'class-validator';

@InputType()
export class RegisterInput {
  @Field()
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email!: string;

  @Field()
  @ApiProperty({ example: 'John Doe', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2) @MaxLength(100)
  displayName!: string;

  @Field()
  @ApiProperty({
    example: 'P@ssw0rd!',
    minLength: 8,
    maxLength: 72,
    description: 'Must contain uppercase, lowercase, number, and special character (@$!%*?&).',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password cannot exceed 72 characters (bcrypt limit).' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password must contain uppercase, lowercase, number, and special character.',
  })
  password!: string;
}