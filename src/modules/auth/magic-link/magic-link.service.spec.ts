import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { MagicLinkService } from './magic-link.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EmailJobName } from '../../../core/queues/queues.constants';

// ── crypto mock — deterministic token ────────────────────────────────────────
// jest.mock is hoisted before variable declarations, so the buffer must be
// defined inline inside the factory to avoid a temporal dead zone error.

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  const fixedBytes = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes, defined inline
  return {
    ...actual,
    default: { ...actual, randomBytes: jest.fn().mockReturnValue(fixedBytes) },
    randomBytes: jest.fn().mockReturnValue(fixedBytes),
  };
});

import crypto from 'crypto';

// These are safe to compute after the mock is in place
const FIXED_BYTES = Buffer.from('a'.repeat(64), 'hex');
const FIXED_TOKEN = FIXED_BYTES.toString('hex');
const FIXED_HASH = crypto.createHash('sha256').update(FIXED_TOKEN).digest('hex');

// ── Factories ─────────────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  user: {
    update: jest.fn(),
    findFirst: jest.fn(),
  },
});

const makeQueueMock = () => ({
  add: jest.fn().mockResolvedValue({}),
});

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue('http://localhost:3000'),
});

const makeP2025 = () =>
  new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '7.0.0',
  });

const makeService = () => {
  const prisma = makePrismaMock();
  const queue = makeQueueMock();
  const config = makeConfigMock();
  const service = new MagicLinkService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    queue as any,
  );
  return { service, prisma, queue, config };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('MagicLinkService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── send() ────────────────────────────────────────────────────────────────────

  describe('send()', () => {
    const email = 'user@test.com';

    it('calls prisma.user.update with lowercased email', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send('User@Test.COM');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'user@test.com' } }),
      );
    });

    it('stores SHA-256 hash of the token (not the raw token)', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send(email);
      const { data } = prisma.user.update.mock.calls[0][0];
      expect(data.magicLinkTokenHash).toBe(FIXED_HASH);
      expect(data.magicLinkTokenHash).not.toBe(FIXED_TOKEN);
    });

    it('sets magicLinkExpiresAt ~15 minutes in the future', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      const before = Date.now();
      await service.send(email);
      const after = Date.now();
      const { data } = prisma.user.update.mock.calls[0][0];
      const expiresAt: Date = data.magicLinkExpiresAt;
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(15 * 60 * 1000 - 100);
      expect(diff).toBeLessThanOrEqual(15 * 60 * 1000 + (after - before) + 100);
    });

    it('enqueues a MAGIC_LINK email job', async () => {
      const { service, prisma, queue } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send(email);
      expect(queue.add).toHaveBeenCalledWith(
        EmailJobName.MAGIC_LINK,
        expect.objectContaining({ to: email }),
      );
    });

    it('email job payload contains displayName', async () => {
      const { service, prisma, queue } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Alice' });
      await service.send(email);
      expect(queue.add).toHaveBeenCalledWith(
        EmailJobName.MAGIC_LINK,
        expect.objectContaining({ displayName: 'Alice' }),
      );
    });

    it('magic link in email job contains the raw token (not the hash)', async () => {
      const { service, prisma, queue } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send(email);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.magicLink).toContain(FIXED_TOKEN);
      expect(payload.magicLink).not.toContain(FIXED_HASH);
    });

    it('magic link uses clientOrigin from config', async () => {
      const { service, prisma, queue, config } = makeService();
      config.get.mockReturnValue('https://app.example.com');
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send(email);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.magicLink).toMatch(/^https:\/\/app\.example\.com/);
    });

    it('email job expiresInMinutes is 15', async () => {
      const { service, prisma, queue } = makeService();
      prisma.user.update.mockResolvedValue({ id: 'user-id', displayName: 'Test User' });
      await service.send(email);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.expiresInMinutes).toBe(15);
    });

    it('silently returns (no throw, no queue job) when user not found (P2025)', async () => {
      const { service, prisma, queue } = makeService();
      prisma.user.update.mockRejectedValue(makeP2025());
      await expect(service.send(email)).resolves.toBeUndefined();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('propagates non-P2025 database errors', async () => {
      const { service, prisma } = makeService();
      prisma.user.update.mockRejectedValue(new Error('DB connection lost'));
      await expect(service.send(email)).rejects.toThrow('DB connection lost');
    });

    it('propagates non-P2025 Prisma errors (e.g. P2002)', async () => {
      const { service, prisma } = makeService();
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.0.0',
      });
      prisma.user.update.mockRejectedValue(p2002);
      await expect(service.send(email)).rejects.toThrow();
    });
  });

  // ── verify() ─────────────────────────────────────────────────────────────────

  describe('verify()', () => {
    it('returns userId on valid, non-expired token', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-id-1' });
      prisma.user.update.mockResolvedValue({});
      const result = await service.verify(FIXED_TOKEN);
      expect(result).toBe('user-id-1');
    });

    it('queries by SHA-256 hash of the token (not the raw token)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-id-1' });
      prisma.user.update.mockResolvedValue({});
      await service.verify(FIXED_TOKEN);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ magicLinkTokenHash: FIXED_HASH }),
        }),
      );
    });

    it('query includes expiry guard (magicLinkExpiresAt > now)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-id-1' });
      prisma.user.update.mockResolvedValue({});
      await service.verify(FIXED_TOKEN);
      const { where } = prisma.user.findFirst.mock.calls[0][0];
      expect(where.magicLinkExpiresAt).toMatchObject({ gt: expect.any(Date) });
    });

    it('throws UnauthorizedException when token not found or expired', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.verify('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('clears magicLinkTokenHash and magicLinkExpiresAt after successful verification (single-use)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue({ id: 'user-id-1' });
      prisma.user.update.mockResolvedValue({});
      await service.verify(FIXED_TOKEN);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: { magicLinkTokenHash: null, magicLinkExpiresAt: null },
      });
    });

    it('does not clear token when verification fails', async () => {
      const { service, prisma } = makeService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.verify('bad-token')).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
