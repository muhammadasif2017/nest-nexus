import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Output DTO — SerializeInterceptor strips anything without @Expose().
@Exclude()
export class DocumentOutput {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  title!: string;

  @ApiProperty()
  @Expose()
  body!: string;

  @ApiProperty()
  @Expose()
  ownerId!: string;

  @ApiProperty({ example: 'private' })
  @Expose()
  visibility!: string;

  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  updatedAt!: Date;
}
