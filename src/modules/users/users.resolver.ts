import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards, UseInterceptors } from '@nestjs/common';
import { UserOutput } from './dto/user.output';
import { UpdateUserInput } from './dto/update-user.input';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SerializeInterceptor } from '../../common/interceptors/serialize.interceptor';

// @UseGuards order matters: JwtAuthGuard runs first (authenticates),
// then RolesGuard runs (authorizes). Think of it as a two-stage checkpoint.
@Resolver(() => UserOutput)
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(new SerializeInterceptor(UserOutput)) // All responses go through UserOutput
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  // ── Admin: Get all users ───────────────────────────────────────────────────
  @Query(() => [UserOutput], { name: 'users' })
  @Roles(Role.ADMIN, Role.SUPER_ADMIN) // Only admins can list all users
  async findAll(): Promise<UserOutput[]> {
    return this.usersService.findAll();
  }

  // ── Authenticated: Get own profile ────────────────────────────────────────
  @Query(() => UserOutput, { name: 'me' })
  // No @Roles() — any authenticated user can access their own profile.
  // JwtAuthGuard is still enforced at the class level.
  async getProfile(@CurrentUser() user: JwtPayload): Promise<UserOutput> {
    return this.usersService.findById(user.sub);
  }

  // ── Public: Get a user by ID (limited fields via UserOutput) ─────────────
  @Query(() => UserOutput, { name: 'user', nullable: true })
  @Public() // Override the class-level JwtAuthGuard for this specific query
  async findOne(@Args('id', { type: () => ID }) id: string): Promise<UserOutput | null> {
    return this.usersService.findById(id);
  }

  // ── Authenticated: Update own profile ─────────────────────────────────────
  @Mutation(() => UserOutput)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateUserInput,
  ): Promise<UserOutput> {
    return this.usersService.update(user.sub, input);
  }

  // ── Admin: Deactivate a user ───────────────────────────────────────────────
  @Mutation(() => UserOutput)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async deactivateUser(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<UserOutput> {
    return this.usersService.deactivate(id);
  }
}