import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { PrismaService } from '../../../prisma/prisma.service';

// PassportSerializer hooks into passport.serializeUser / passport.deserializeUser.
// serializeUser: decides what to store in the session (just the ID — minimal surface area)
// deserializeUser: reconstructs the user object from the stored ID on each request
//
// This is only invoked when passport.session() middleware is active (main.ts).
// The current implementation uses express-session directly (without passport.session()),
// so this serializer is registered but dormant — ready for activation if the auth
// strategy is switched to full Passport session mode.
@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  serializeUser(user: { id: string }, done: (err: Error | null, id: string) => void): void {
    done(null, user.id);
  }

  async deserializeUser(
    id: string,
    done: (err: Error | null, user: object | false) => void,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, roles: true, isActive: true },
      });
      // false signals to Passport that the session is invalid (user deleted/deactivated)
      done(null, user ?? false);
    } catch (err) {
      done(err as Error, false);
    }
  }
}
