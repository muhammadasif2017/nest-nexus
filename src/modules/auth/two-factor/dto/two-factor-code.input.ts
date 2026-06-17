import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorCodeInput {
  @ApiProperty({ description: '6-digit TOTP code or 9-char backup code (XXXX-XXXX)', example: '123456' })
  @IsString()
  @Length(6, 9)
  code!: string;
}
