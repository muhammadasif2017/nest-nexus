import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { UserLoader } from './loaders/user.loader';

@Module({
  imports: [
    // Register the Mongoose model within this module's scope.
    // Other modules that need the User model should import UsersModule,
    // not re-register it — this prevents duplicate model registrations.
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [
    UsersService,
    UsersResolver,
    UserLoader, // Request-scoped DataLoader
  ],
  // Export UsersService so AuthModule can use findByEmail without re-importing Mongoose
  exports: [UsersService],
})
export class UsersModule {}