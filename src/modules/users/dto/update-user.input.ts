import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MinLength, MaxLength } from 'class-validator';

export class UpdateUserInput {
  @ApiProperty({ required: false, example: 'John Doe', minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @ApiProperty({ required: false, example: 'https://cdn.example.com/avatar.png' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
