import { IsString, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MagicLinkSendInput {
  @ApiProperty({ description: 'Email address to send the magic link to' })
  @IsEmail()
  email!: string;
}

export class MagicLinkVerifyInput {
  @ApiProperty({ description: 'Token from the magic link URL' })
  @IsString()
  token!: string;
}
