import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard, createApiKeyExpressMiddleware } from './api-key.guard';
import { ApiKeyService } from '../../modules/auth/api-key/api-key.service';

const makeApiKeyServiceMock = () => ({
  validate: jest.fn(),
});

const makeHttpContext = (headers: Record<string, string> = {}): ExecutionContext => {
  const request: any = { headers };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('ApiKeyGuard', () => {
  it('throws UnauthorizedException when X-API-Key header is missing', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    const guard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
    const context = makeHttpContext();
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('validates the key from the X-API-Key header', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockResolvedValue({ id: 'key-1', userId: 'user-1', scopes: [] });
    const guard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
    const context = makeHttpContext({ 'x-api-key': 'raw-key-value' });
    await guard.canActivate(context);
    expect(apiKeyService.validate).toHaveBeenCalledWith('raw-key-value');
  });

  it('attaches the validated key to the request as req.apiKey', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockResolvedValue({ id: 'key-1', userId: 'user-1', scopes: ['read'] });
    const guard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
    const request: any = { headers: { 'x-api-key': 'raw-key-value' } };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    expect(request.apiKey).toEqual({ id: 'key-1', userId: 'user-1', scopes: ['read'] });
  });

  it('returns true when the key is valid', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockResolvedValue({ id: 'key-1', userId: 'user-1', scopes: [] });
    const guard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
    const context = makeHttpContext({ 'x-api-key': 'raw-key-value' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('propagates UnauthorizedException from ApiKeyService.validate (e.g. revoked key)', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockRejectedValue(
      new UnauthorizedException('Invalid or revoked API key.'),
    );
    const guard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
    const context = makeHttpContext({ 'x-api-key': 'raw-key-value' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});

describe('createApiKeyExpressMiddleware()', () => {
  const makeReqRes = (headers: Record<string, string> = {}) => {
    const req: any = { headers };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  };

  it('responds 401 when X-API-Key header is missing', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    const middleware = createApiKeyExpressMiddleware(apiKeyService as unknown as ApiKeyService);
    const { req, res, next } = makeReqRes();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the key is valid', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockResolvedValue({ id: 'key-1', userId: 'user-1', scopes: [] });
    const middleware = createApiKeyExpressMiddleware(apiKeyService as unknown as ApiKeyService);
    const { req, res, next } = makeReqRes({ 'x-api-key': 'raw-key-value' });
    await middleware(req, res, next);
    expect(apiKeyService.validate).toHaveBeenCalledWith('raw-key-value');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 401 when ApiKeyService.validate rejects (unknown/revoked key)', async () => {
    const apiKeyService = makeApiKeyServiceMock();
    apiKeyService.validate.mockRejectedValue(
      new UnauthorizedException('Invalid or revoked API key.'),
    );
    const middleware = createApiKeyExpressMiddleware(apiKeyService as unknown as ApiKeyService);
    const { req, res, next } = makeReqRes({ 'x-api-key': 'bad-key' });
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
