import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VISIBILITIES } from './create-document.input';

export class UpdateDocumentInput {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  body?: string;

  @ApiProperty({ enum: VISIBILITIES, required: false })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];
}
