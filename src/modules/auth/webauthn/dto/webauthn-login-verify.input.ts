import { IsEmail, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export class WebauthnLoginVerifyInput {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'AuthenticationResponseJSON returned by the browser' })
  @IsObject()
  response!: AuthenticationResponseJSON;
}
