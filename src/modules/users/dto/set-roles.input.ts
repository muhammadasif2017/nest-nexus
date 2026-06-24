import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsEnum } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

// Roles are settable ONLY through this DTO on the super_admin-gated route —
// never via register or self-update. Keeping the field off UpdateUserInput is
// what prevents a user from escalating their own privileges.
export class SetRolesInput {
  @ApiProperty({ enum: Role, isArray: true, example: [Role.MODERATOR] })
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}
