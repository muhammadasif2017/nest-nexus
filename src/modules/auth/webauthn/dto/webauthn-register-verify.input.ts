import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export class WebauthnRegisterVerifyInput {
  @ApiProperty({ description: 'RegistrationResponseJSON returned by the browser' })
  @IsObject()
  response!: RegistrationResponseJSON;
}
