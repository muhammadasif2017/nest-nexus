import { InputType, Field } from '@nestjs/graphql';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @Field()
  @ApiProperty({ example: 'P@ssw0rd!', minLength: 1 })
  @IsString()
  @MinLength(1)
  password!: string;
}
