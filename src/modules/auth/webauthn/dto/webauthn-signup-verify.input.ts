import { IsEmail, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export class WebauthnSignupVerifyInput {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'RegistrationResponseJSON returned by the browser' })
  @IsObject()
  response!: RegistrationResponseJSON;
}
