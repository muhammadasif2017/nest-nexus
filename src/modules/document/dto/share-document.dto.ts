import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Relation } from '../../authorization/rebac/relation.service';

// Body for sharing a document — grant/revoke a ReBAC relation to another user.
// The document is identified by the :id route param, so only the grantee +
// relation are in the body.
export class ShareDocumentDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @ApiProperty({ enum: Relation, example: Relation.VIEWER })
  @IsEnum(Relation)
  relation!: Relation;
}
