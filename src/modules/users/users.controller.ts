import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UserOutput } from './dto/user.output';
import { UpdateUserInput } from './dto/update-user.input';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// JwtAuthGuard is applied globally (APP_GUARD), so every route here is
// authenticated unless marked @Public(). RolesGuard adds the authorization
// layer on top for admin-only routes — it runs after the global JwtAuthGuard.
@ApiTags('users')
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Authenticated: Get own profile ────────────────────────────────────────
  // Declared before :id so "me" is never captured as an id param.
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ status: 200, description: 'Current user profile.', type: UserOutput })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async getProfile(@CurrentUser() user: JwtPayload): Promise<UserOutput> {
    return this.usersService.findById(user.sub);
  }

  // ── Admin: List all active users ──────────────────────────────────────────
  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List all active users (admin only)' })
  @ApiResponse({ status: 200, description: 'Active users.', type: [UserOutput] })
  @ApiResponse({ status: 403, description: 'Requires admin role.' })
  async findAll(): Promise<UserOutput[]> {
    return this.usersService.findAll();
  }

  // ── Authenticated: Get a user by ID (limited fields via UserOutput) ───────
  // Requires a valid JWT (global JwtAuthGuard) — not public, to avoid
  // email/role disclosure by ID enumeration.
  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a user by ID (authenticated, limited fields)' })
  @ApiResponse({ status: 200, description: 'User found.', type: UserOutput })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async findOne(@Param('id') id: string): Promise<UserOutput | null> {
    try {
      return await this.usersService.findById(id);
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
  }

  // ── Authenticated: Update own profile ─────────────────────────────────────
  @Patch('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update own profile' })
  @ApiBody({ type: UpdateUserInput })
  @ApiResponse({ status: 200, description: 'Profile updated.', type: UserOutput })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() input: UpdateUserInput,
  ): Promise<UserOutput> {
    return this.usersService.update(user.sub, input);
  }

  // ── Admin: Deactivate a user (soft delete) ────────────────────────────────
  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Deactivate a user (admin only, soft delete)' })
  @ApiResponse({ status: 200, description: 'User deactivated.', type: UserOutput })
  @ApiResponse({ status: 403, description: 'Requires admin role.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async deactivateUser(@Param('id') id: string): Promise<UserOutput> {
    return this.usersService.deactivate(id);
  }
}
