import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiKeyService } from '../../modules/auth/api-key/api-key.service';
import { getRequestFromContext } from '../utils/execution-context.util';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequestFromContext(context);
    const rawKey = request.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      throw new UnauthorizedException('Missing X-API-Key header.');
    }

    request.apiKey = await this.apiKeyService.validate(rawKey);
    return true;
  }
}

// For routes mounted outside Nest's request pipeline (e.g. a third-party Express
// router like Bull Board) where @UseGuards() can't be applied — same validation
// logic as ApiKeyGuard, exposed as a plain Express middleware factory.
export function createApiKeyExpressMiddleware(apiKeyService: ApiKeyService) {
  return async (req: Request, res: Response, next: () => void): Promise<void> => {
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      res.status(401).json({ message: 'Missing X-API-Key header.' });
      return;
    }

    try {
      await apiKeyService.validate(rawKey);
      next();
    } catch {
      res.status(401).json({ message: 'Invalid or revoked API key.' });
    }
  };
}
