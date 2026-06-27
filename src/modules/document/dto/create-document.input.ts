import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const VISIBILITIES = ['private', 'internal', 'public'] as const;

export class CreateDocumentInput {
  @ApiProperty({ example: 'Quarterly report' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Body text…' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  body!: string;

  @ApiProperty({ enum: VISIBILITIES, required: false, default: 'private' })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];
}
