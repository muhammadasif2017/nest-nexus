import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebauthnLoginOptionsInput {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;
}
