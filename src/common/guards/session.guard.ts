import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Session auth stores userId after successful session/login.
    // No userId = no session, or session was destroyed.
    const userId = (request.session as any)?.userId;

    if (!userId) {
      throw new UnauthorizedException('No active session.');
    }

    return true;
  }
}
