import 'reflect-metadata';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';
import { WebauthnService } from './webauthn.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const mockGenerateRegOptions = generateRegistrationOptions as jest.Mock;
const mockVerifyReg = verifyRegistrationResponse as jest.Mock;
const mockGenerateAuthOptions = generateAuthenticationOptions as jest.Mock;
const mockVerifyAuth = verifyAuthenticationResponse as jest.Mock;

const makePrismaMock = () => ({
  webauthnCredential: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
});

const makeCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

const makeEventEmitterMock = () => ({
  emit: jest.fn(),
});

const makeConfigMock = () => ({
  get: jest.fn((key: string) => {
    if (key === 'app.webauthnRpId') return 'localhost';
    if (key === 'app.webauthnRpName') return 'nest-nexus';
    if (key === 'app.clientOrigin') return 'http://localhost:5173';
    return undefined;
  }),
});

const makeService = () => {
  const prisma = makePrismaMock();
  const cache = makeCacheMock();
  const config = makeConfigMock();
  const eventEmitter = makeEventEmitterMock();
  const service = new WebauthnService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    cache as unknown as Cache,
    eventEmitter as unknown as EventEmitter2,
  );
  return { service, prisma, cache, config, eventEmitter };
};

describe('WebauthnService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registerOptions()', () => {
    it('generates options scoped to rpID/rpName from config', async () => {
      const { service, prisma } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue(null);
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'reg-challenge' });
      await service.registerOptions('user-1', 'alice@test.com');
      expect(mockGenerateRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          rpName: 'nest-nexus',
          userName: 'alice@test.com',
        }),
      );
    });

    it('excludes the existing credential when one is already registered', async () => {
      const { service, prisma } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue({
        credentialId: 'cred-1',
        transports: ['internal'],
      });
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'reg-challenge' });
      await service.registerOptions('user-1', 'alice@test.com');
      expect(mockGenerateRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [{ id: 'cred-1', transports: ['internal'] }],
        }),
      );
    });

    it('stores the generated challenge in cache keyed by userId', async () => {
      const { service, prisma, cache } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue(null);
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'reg-challenge' });
      await service.registerOptions('user-1', 'alice@test.com');
      expect(cache.set).toHaveBeenCalledWith(
        'webauthn:register:user-1',
        'reg-challenge',
        expect.any(Number),
      );
    });
  });

  describe('registerVerify()', () => {
    const response = { id: 'cred-1' } as any;

    it('throws UnauthorizedException when no challenge is cached', async () => {
      const { service, cache } = makeService();
      cache.get.mockResolvedValue(null);
      await expect(service.registerVerify('user-1', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when verification fails', async () => {
      const { service, cache } = makeService();
      cache.get.mockResolvedValue('reg-challenge');
      mockVerifyReg.mockResolvedValue({ verified: false });
      await expect(service.registerVerify('user-1', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('upserts the credential on successful verification', async () => {
      const { service, prisma, cache } = makeService();
      cache.get.mockResolvedValue('reg-challenge');
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-1',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
        },
      });
      await service.registerVerify('user-1', response);
      expect(prisma.webauthnCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({ userId: 'user-1', credentialId: 'cred-1' }),
        }),
      );
    });

    it('clears the cached challenge after successful verification', async () => {
      const { service, cache } = makeService();
      cache.get.mockResolvedValue('reg-challenge');
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 },
        },
      });
      await service.registerVerify('user-1', response);
      expect(cache.del).toHaveBeenCalledWith('webauthn:register:user-1');
    });
  });

  describe('loginOptions()', () => {
    it('returns options with allowCredentials populated when a credential exists', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        webauthnCredential: { credentialId: 'cred-1', transports: ['internal'] },
      });
      mockGenerateAuthOptions.mockResolvedValue({ challenge: 'login-challenge' });
      await service.loginOptions('alice@test.com');
      expect(mockGenerateAuthOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [{ id: 'cred-1', transports: ['internal'] }],
        }),
      );
    });

    it('returns options with empty allowCredentials when no user/credential is found (no enumeration)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      mockGenerateAuthOptions.mockResolvedValue({ challenge: 'login-challenge' });
      await service.loginOptions('nobody@test.com');
      expect(mockGenerateAuthOptions).toHaveBeenCalledWith(
        expect.objectContaining({ allowCredentials: [] }),
      );
    });

    it('stores the generated challenge in cache keyed by lowercased email', async () => {
      const { service, prisma, cache } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      mockGenerateAuthOptions.mockResolvedValue({ challenge: 'login-challenge' });
      await service.loginOptions('Alice@Test.com');
      expect(cache.set).toHaveBeenCalledWith(
        'webauthn:login:alice@test.com',
        'login-challenge',
        expect.any(Number),
      );
    });
  });

  describe('loginVerify()', () => {
    const response = { id: 'cred-1' } as any;

    it('throws UnauthorizedException when no challenge is cached', async () => {
      const { service, cache } = makeService();
      cache.get.mockResolvedValue(null);
      await expect(service.loginVerify('alice@test.com', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when no credential is registered for the user', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue('login-challenge');
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', webauthnCredential: null });
      await expect(service.loginVerify('alice@test.com', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when verification fails', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue('login-challenge');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        webauthnCredential: {
          id: 'wc-1',
          credentialId: 'cred-1',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          transports: [],
        },
      });
      mockVerifyAuth.mockResolvedValue({ verified: false });
      await expect(service.loginVerify('alice@test.com', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns the userId and updates the counter on successful verification', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue('login-challenge');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        webauthnCredential: {
          id: 'wc-1',
          credentialId: 'cred-1',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          transports: [],
        },
      });
      mockVerifyAuth.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      const result = await service.loginVerify('alice@test.com', response);
      expect(result).toBe('user-1');
      expect(prisma.webauthnCredential.update).toHaveBeenCalledWith({
        where: { id: 'wc-1' },
        data: { counter: 1 },
      });
    });

    it('clears the cached challenge after successful verification', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue('login-challenge');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        webauthnCredential: {
          id: 'wc-1',
          credentialId: 'cred-1',
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0,
          transports: [],
        },
      });
      mockVerifyAuth.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      await service.loginVerify('alice@test.com', response);
      expect(cache.del).toHaveBeenCalledWith('webauthn:login:alice@test.com');
    });
  });

  describe('deleteCredential()', () => {
    it('deletes the credential owned by the user', async () => {
      const { service, prisma } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue({ id: 'wc-1', userId: 'user-1' });
      prisma.webauthnCredential.delete.mockResolvedValue({});
      await service.deleteCredential('user-1');
      expect(prisma.webauthnCredential.delete).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('throws NotFoundException when no credential is registered for the user', async () => {
      const { service, prisma } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue(null);
      await expect(service.deleteCredential('user-1')).rejects.toThrow(NotFoundException);
    });

    it('does not call delete when no credential is found', async () => {
      const { service, prisma } = makeService();
      prisma.webauthnCredential.findUnique.mockResolvedValue(null);
      await expect(service.deleteCredential('user-1')).rejects.toThrow();
      expect(prisma.webauthnCredential.delete).not.toHaveBeenCalled();
    });
  });

  describe('signupOptions()', () => {
    it('throws ConflictException when the email is already taken', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
      await expect(service.signupOptions('alice@test.com', 'Alice')).rejects.toThrow(
        ConflictException,
      );
    });

    it('generates options scoped to rpID/rpName/userName from config and email', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'signup-challenge' });
      await service.signupOptions('alice@test.com', 'Alice');
      expect(mockGenerateRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          rpName: 'nest-nexus',
          userName: 'alice@test.com',
        }),
      );
    });

    it('stores the challenge and displayName in cache keyed by lowercased email', async () => {
      const { service, prisma, cache } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'signup-challenge' });
      await service.signupOptions('Alice@Test.com', 'Alice');
      expect(cache.set).toHaveBeenCalledWith(
        'webauthn:signup:alice@test.com',
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
        expect.any(Number),
      );
    });
  });

  describe('signupVerify()', () => {
    const response = { id: 'cred-1' } as any;

    it('throws UnauthorizedException when no pending signup is cached', async () => {
      const { service, cache } = makeService();
      cache.get.mockResolvedValue(null);
      await expect(service.signupVerify('alice@test.com', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws ConflictException when the email was taken after options were issued', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
      await expect(service.signupVerify('alice@test.com', response)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws UnauthorizedException when verification fails', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      mockVerifyReg.mockResolvedValue({ verified: false });
      await expect(service.signupVerify('alice@test.com', response)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('creates a user with no password on successful verification', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user-1' });
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        },
      });
      await service.signupVerify('alice@test.com', response);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'alice@test.com',
          displayName: 'Alice',
          password: null,
          hasPassword: false,
        }),
      });
    });

    it('creates the credential linked to the new user', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user-1' });
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        },
      });
      await service.signupVerify('alice@test.com', response);
      expect(prisma.webauthnCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'new-user-1', credentialId: 'cred-1' }),
      });
    });

    it('emits user.created and returns the new userId', async () => {
      const { service, cache, prisma, eventEmitter } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user-1' });
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        },
      });
      const result = await service.signupVerify('alice@test.com', response);
      expect(result).toBe('new-user-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.created', { userId: 'new-user-1' });
    });

    it('clears the cached pending signup after successful verification', async () => {
      const { service, cache, prisma } = makeService();
      cache.get.mockResolvedValue(
        JSON.stringify({ challenge: 'signup-challenge', displayName: 'Alice' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user-1' });
      mockVerifyReg.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        },
      });
      await service.signupVerify('alice@test.com', response);
      expect(cache.del).toHaveBeenCalledWith('webauthn:signup:alice@test.com');
    });
  });
});
