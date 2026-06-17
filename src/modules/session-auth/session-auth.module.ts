import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionAuthController } from './session-auth.controller';
import { SessionGuard } from './session-auth.guard';
import { SessionSerializer } from './strategies/session.strategy';

@Module({
  imports: [AuthModule], // for AuthService — credential checks reuse the same login logic as JWT auth
  providers: [SessionGuard, SessionSerializer],
  controllers: [SessionAuthController],
})
export class SessionAuthModule {}
