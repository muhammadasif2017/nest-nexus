import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { UserLoader } from './loaders/user.loader';

@Module({
  providers: [UsersService, UsersResolver, UserLoader],
  exports: [UsersService],
})
export class UsersModule {}
