import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorService } from './two-factor.service';
import { PrismaService } from '../../../prisma/prisma.service';

// ── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('otplib', () => ({
  authenticator: {
    generateSecret: jest.fn().mockReturnValue('MOCK_TOTP_SECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/test'),
    verify: jest.fn(),
  },
}));

jest.mock('qrcode', () => ({
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK') },
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK'),
}));

jest.mock('../../../common/crypto/totp-crypto.util', () => ({
  encryptTotpSecret: jest.fn().mockReturnValue('enc:MOCK_ENCRYPTED'),
  decryptTotpSecret: jest.fn().mockReturnValue('MOCK_TOTP_SECRET'),
}));

import { authenticator } from 'otplib';
import { encryptTotpSecret, decryptTotpSecret } from '../../../common/crypto/totp-crypto.util';

const mockAuthenticator = authenticator as jest.Mocked<typeof authenticator>;
const mockEncrypt = encryptTotpSecret as jest.Mock;
const mockDecrypt = decryptTotpSecret as jest.Mock;

// ── Factories ─────────────────────────────────────────────────────────────────

const TEST_KEY = 'a'.repeat(64);

const makePrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
});

const makeConfigMock = () => ({
  get: jest.fn().mockReturnValue(TEST_KEY),
});

const makeService = () => {
  const prisma = makePrismaMock();
  const config = makeConfigMock();
  const service = new TwoFactorService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  return { service, prisma, config };
};

// ── User fixtures ─────────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  email: 'user@test.com',
  twoFactorSecret: 'enc:MOCK_ENCRYPTED',
  isTwoFactorEnabled: false,
  twoFactorBackupCodes: [],
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TwoFactorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEncrypt.mockReturnValue('enc:MOCK_ENCRYPTED');
    mockDecrypt.mockReturnValue('MOCK_TOTP_SECRET');
    (mockAuthenticator.generateSecret as jest.Mock).mockReturnValue('MOCK_TOTP_SECRET');
    (mockAuthenticator.keyuri as jest.Mock).mockReturnValue('otpauth://totp/test');
    mockAuthenticator.verify.mockReturnValue(false);
  });

  // ── setup() ──────────────────────────────────────────────────────────────────

  describe('setup()', () => {
    it('throws NotFoundException when user does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setup('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('returns secret, otpauthUrl, and qrCodeDataUrl', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      const result = await service.setup('user-id');
      expect(result).toMatchObject({
        secret: expect.any(String),
        otpauthUrl: expect.any(String),
        qrCodeDataUrl: expect.any(String),
      });
    });

    it('returns the plaintext secret (not the encrypted form)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      const result = await service.setup('user-id');
      expect(result.secret).toBe('MOCK_TOTP_SECRET');
      expect(result.secret).not.toMatch(/^enc:/);
    });

    it('stores encrypted secret in the database', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      await service.setup('user-id');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id' },
          data: expect.objectContaining({ twoFactorSecret: 'enc:MOCK_ENCRYPTED' }),
        }),
      );
    });

    it('calls encryptTotpSecret with the generated secret and key', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      await service.setup('user-id');
      expect(mockEncrypt).toHaveBeenCalledWith('MOCK_TOTP_SECRET', TEST_KEY);
    });

    it('generates otpauthUrl with user email and app name', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      await service.setup('user-id');
      expect(mockAuthenticator.keyuri).toHaveBeenCalledWith('user@test.com', 'Nexus', 'MOCK_TOTP_SECRET');
    });

    it('qrCodeDataUrl starts with data:', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({ email: 'user@test.com' });
      const result = await service.setup('user-id');
      expect(result.qrCodeDataUrl).toMatch(/^data:/);
    });
  });

  // ── enable() ─────────────────────────────────────────────────────────────────

  describe('enable()', () => {
    it('throws BadRequestException when twoFactorSecret is missing (setup not run)', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ twoFactorSecret: null }));
      await expect(service.enable('user-id', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when 2FA is already enabled', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ isTwoFactorEnabled: true }));
      await expect(service.enable('user-id', '123456')).rejects.toThrow(ConflictException);
    });

    it('throws UnauthorizedException when TOTP code is invalid', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(false);
      await expect(service.enable('user-id', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('calls decryptTotpSecret before verifying TOTP', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      await service.enable('user-id', '123456');
      expect(mockDecrypt).toHaveBeenCalledWith('enc:MOCK_ENCRYPTED', TEST_KEY);
    });

    it('returns 10 backup codes on success', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      const codes = await service.enable('user-id', '123456');
      expect(codes).toHaveLength(10);
    });

    it('backup codes match XXXX-XXXX hex format', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      const codes = await service.enable('user-id', '123456');
      codes.forEach((c) => expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/));
    });

    it('sets isTwoFactorEnabled to true in DB', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      await service.enable('user-id', '123456');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isTwoFactorEnabled: true }),
        }),
      );
    });

    it('stores hashed backup codes (not plaintext) in DB', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      const codes = await service.enable('user-id', '123456');
      const { data } = prisma.user.update.mock.calls[0][0];
      // Hashed codes should not contain the raw hex codes
      data.twoFactorBackupCodes.forEach((hash: string, i: number) => {
        expect(hash).not.toBe(codes[i].replace('-', ''));
        expect(hash).toHaveLength(64); // SHA-256 hex
      });
    });

    it('backup code hash is deterministic: stored hash matches what verify() looks for', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mockAuthenticator.verify.mockReturnValue(true);
      const codes = await service.enable('user-id', '123456');
      const storedHash = (prisma.user.update.mock.calls[0][0] as any).data.twoFactorBackupCodes[0];
      // verify() strips dashes and uppercases before hashing — enable() must do the same
      const crypto = await import('crypto');
      const strippedCode = codes[0].replace(/-/g, '').toUpperCase();
      const expectedHash = crypto.createHash('sha256').update('user-id:' + strippedCode).digest('hex');
      expect(storedHash).toBe(expectedHash);
    });
  });

  // ── disable() ────────────────────────────────────────────────────────────────

  describe('disable()', () => {
    it('throws BadRequestException when 2FA is not enabled', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ isTwoFactorEnabled: false }));
      await expect(service.disable('user-id', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when code is invalid', async () => {
      const { service, prisma } = makeService();
      // First findUnique for the enabled check, second for verify() internal call
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }))
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }));
      mockAuthenticator.verify.mockReturnValue(false);
      await expect(service.disable('user-id', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('clears isTwoFactorEnabled, twoFactorSecret, and twoFactorBackupCodes on success', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }))
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }));
      mockAuthenticator.verify.mockReturnValue(true);
      await service.disable('user-id', '123456');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id' },
          data: { isTwoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
        }),
      );
    });

    it('resolves without returning a value on success', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }))
        .mockResolvedValueOnce(makeUser({ isTwoFactorEnabled: true }));
      mockAuthenticator.verify.mockReturnValue(true);
      const result = await service.disable('user-id', '123456');
      expect(result).toBeUndefined();
    });
  });

  // ── verify() ─────────────────────────────────────────────────────────────────

  describe('verify()', () => {
    it('returns false when 2FA is not enabled', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ isTwoFactorEnabled: false }));
      expect(await service.verify('user-id', '123456')).toBe(false);
    });

    it('returns false when twoFactorSecret is null', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isTwoFactorEnabled: true, twoFactorSecret: null }),
      );
      expect(await service.verify('user-id', '123456')).toBe(false);
    });

    it('returns true for valid TOTP code', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ isTwoFactorEnabled: true }));
      mockAuthenticator.verify.mockReturnValue(true);
      expect(await service.verify('user-id', '123456')).toBe(true);
    });

    it('returns false for invalid TOTP code and no matching backup code', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isTwoFactorEnabled: true, twoFactorBackupCodes: [] }),
      );
      mockAuthenticator.verify.mockReturnValue(false);
      expect(await service.verify('user-id', 'wrong')).toBe(false);
    });

    it('returns true for valid backup code', async () => {
      const { service, prisma } = makeService();
      const crypto = await import('crypto');
      const code = 'ABCD1234';
      const hash = crypto.createHash('sha256').update('user-id:' + code).digest('hex');
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isTwoFactorEnabled: true, twoFactorBackupCodes: [hash] }),
      );
      mockAuthenticator.verify.mockReturnValue(false);
      // Pass with dashes — service strips them
      expect(await service.verify('user-id', 'ABCD-1234')).toBe(true);
    });

    it('backup code is single-use: removes matched code from DB', async () => {
      const { service, prisma } = makeService();
      const crypto = await import('crypto');
      const code = 'ABCD1234';
      const hash = crypto.createHash('sha256').update('user-id:' + code).digest('hex');
      const otherHash = 'other-hash-value';
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isTwoFactorEnabled: true, twoFactorBackupCodes: [hash, otherHash] }),
      );
      mockAuthenticator.verify.mockReturnValue(false);
      await service.verify('user-id', 'ABCD-1234');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { twoFactorBackupCodes: [otherHash] },
        }),
      );
    });

    it('backup code matching is case-insensitive after dash stripping', async () => {
      const { service, prisma } = makeService();
      const crypto = await import('crypto');
      // Hash computed with uppercase stripped code
      const hash = crypto.createHash('sha256').update('user-id:ABCD1234').digest('hex');
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isTwoFactorEnabled: true, twoFactorBackupCodes: [hash] }),
      );
      mockAuthenticator.verify.mockReturnValue(false);
      // Service does .replace(/-/g, '').toUpperCase() before hashing
      expect(await service.verify('user-id', 'abcd-1234')).toBe(true);
    });

    it('decrypts secret before calling authenticator.verify', async () => {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(makeUser({ isTwoFactorEnabled: true }));
      mockAuthenticator.verify.mockReturnValue(true);
      await service.verify('user-id', '123456');
      expect(mockDecrypt).toHaveBeenCalledWith('enc:MOCK_ENCRYPTED', TEST_KEY);
      expect(mockAuthenticator.verify).toHaveBeenCalledWith({
        token: '123456',
        secret: 'MOCK_TOTP_SECRET',
      });
    });
  });
});
