import 'reflect-metadata';
import { ApiKeyController } from './api-key.controller';
import { CreateApiKeyInput } from './dto/create-api-key.input';
import { JwtPayload } from '../strategies/jwt.strategy';

const makeApiKeyServiceMock = () => ({
  create: jest.fn(),
  revoke: jest.fn(),
});

const makeController = () => {
  const apiKeyService = makeApiKeyServiceMock();
  const controller = new ApiKeyController(apiKeyService as any);
  return { controller, apiKeyService };
};

const user: JwtPayload = { sub: 'user-id-1', email: 'user@test.com', roles: ['user'] };

describe('ApiKeyController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create()', () => {
    it('creates a key scoped to the current user and returns the raw key', async () => {
      const { controller, apiKeyService } = makeController();
      apiKeyService.create.mockResolvedValue({ rawKey: 'raw-key-value' });
      const dto: CreateApiKeyInput = { scopes: ['read'] };
      const result = await controller.create(user, dto);
      expect(apiKeyService.create).toHaveBeenCalledWith('user-id-1', ['read']);
      expect(result).toEqual({ apiKey: 'raw-key-value' });
    });

    it('defaults to an empty scopes array when none provided', async () => {
      const { controller, apiKeyService } = makeController();
      apiKeyService.create.mockResolvedValue({ rawKey: 'raw-key-value' });
      await controller.create(user, {});
      expect(apiKeyService.create).toHaveBeenCalledWith('user-id-1', []);
    });
  });

  describe('revoke()', () => {
    it('revokes the key scoped to the current user', async () => {
      const { controller, apiKeyService } = makeController();
      apiKeyService.revoke.mockResolvedValue(undefined);
      await controller.revoke(user, 'key-1');
      expect(apiKeyService.revoke).toHaveBeenCalledWith('key-1', 'user-id-1');
    });
  });
});
