import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebauthnSignupOptionsInput {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @Length(1, 100)
  displayName!: string;
}
