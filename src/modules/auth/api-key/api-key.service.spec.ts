import 'reflect-metadata';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiKeyService } from './api-key.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  const fixedBytes = Buffer.from('b'.repeat(64), 'hex'); // 32 bytes, defined inline
  return {
    ...actual,
    default: { ...actual, randomBytes: jest.fn().mockReturnValue(fixedBytes) },
    randomBytes: jest.fn().mockReturnValue(fixedBytes),
  };
});

import crypto from 'crypto';

const FIXED_BYTES = Buffer.from('b'.repeat(64), 'hex');
const FIXED_RAW_KEY = FIXED_BYTES.toString('hex');
const FIXED_HASH = crypto.createHash('sha256').update(FIXED_RAW_KEY).digest('hex');

const makePrismaMock = () => ({
  apiKey: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});

const makeEventEmitterMock = () => ({
  emit: jest.fn(),
});

const makeService = () => {
  const prisma = makePrismaMock();
  const eventEmitter = makeEventEmitterMock();
  const service = new ApiKeyService(
    prisma as unknown as PrismaService,
    eventEmitter as unknown as EventEmitter2,
  );
  return { service, prisma, eventEmitter };
};

describe('ApiKeyService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create()', () => {
    it('returns the raw key (not the hash) to the caller', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.create.mockResolvedValue({ id: 'key-1' });
      const { rawKey } = await service.create('user-1', ['read']);
      expect(rawKey).toBe(FIXED_RAW_KEY);
    });

    it('stores the SHA-256 hash of the key, not the raw key', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.create.mockResolvedValue({ id: 'key-1' });
      await service.create('user-1', ['read']);
      const { data } = prisma.apiKey.create.mock.calls[0][0];
      expect(data.keyHash).toBe(FIXED_HASH);
      expect(data.keyHash).not.toBe(FIXED_RAW_KEY);
    });

    it('stores provided scopes and userId', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.create.mockResolvedValue({ id: 'key-1' });
      await service.create('user-1', ['read', 'write']);
      const { data } = prisma.apiKey.create.mock.calls[0][0];
      expect(data.userId).toBe('user-1');
      expect(data.scopes).toEqual(['read', 'write']);
    });

    it('emits apiKey.created event', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.apiKey.create.mockResolvedValue({ id: 'key-1' });
      await service.create('user-1', []);
      expect(eventEmitter.emit).toHaveBeenCalledWith('apiKey.created', { userId: 'user-1' });
    });
  });

  describe('validate()', () => {
    it('returns the key record for a valid, non-revoked key', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['read'],
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});
      const result = await service.validate(FIXED_RAW_KEY);
      expect(result.userId).toBe('user-1');
    });

    it('looks up by SHA-256 hash of the raw key', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: [],
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});
      await service.validate(FIXED_RAW_KEY);
      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { keyHash: FIXED_HASH } }),
      );
    });

    it('updates lastUsedAt on successful validation', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: [],
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});
      await service.validate(FIXED_RAW_KEY);
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('throws UnauthorizedException when key is not found', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.validate('unknown-key')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when key is revoked', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: [],
        revokedAt: new Date(),
      });
      await expect(service.validate(FIXED_RAW_KEY)).rejects.toThrow(UnauthorizedException);
    });

    it('does not update lastUsedAt when key is revoked', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: [],
        revokedAt: new Date(),
      });
      await expect(service.validate(FIXED_RAW_KEY)).rejects.toThrow();
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });

  describe('revoke()', () => {
    it('sets revokedAt for a key owned by the user', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', userId: 'user-1' });
      prisma.apiKey.update.mockResolvedValue({});
      await service.revoke('key-1', 'user-1');
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('scopes the lookup to the owning userId', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', userId: 'user-1' });
      prisma.apiKey.update.mockResolvedValue({});
      await service.revoke('key-1', 'user-1');
      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
        where: { id: 'key-1', userId: 'user-1' },
      });
    });

    it('emits apiKey.revoked event', async () => {
      const { service, prisma, eventEmitter } = makeService();
      prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', userId: 'user-1' });
      prisma.apiKey.update.mockResolvedValue({});
      await service.revoke('key-1', 'user-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('apiKey.revoked', {
        userId: 'user-1',
        keyId: 'key-1',
      });
    });

    it('throws NotFoundException when key does not exist or is not owned by user', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findFirst.mockResolvedValue(null);
      await expect(service.revoke('key-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('does not call update when key is not found', async () => {
      const { service, prisma } = makeService();
      prisma.apiKey.findFirst.mockResolvedValue(null);
      await expect(service.revoke('key-1', 'user-1')).rejects.toThrow();
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });
});
