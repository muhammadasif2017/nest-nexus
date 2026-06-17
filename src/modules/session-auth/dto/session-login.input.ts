import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

// REST-only DTO (no @InputType/@Field) — session auth is never exposed over GraphQL.
export class SessionLoginInput {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'P@ssw0rd!', minLength: 1 })
  @IsString()
  @MinLength(1)
  password!: string;
}
