import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorCodeInput {
  @ApiProperty({
    description: '6-digit TOTP code or 19-char backup code (XXXX-XXXX-XXXX-XXXX)',
    example: '123456',
  })
  @IsString()
  @Length(6, 19)
  code!: string;
}
