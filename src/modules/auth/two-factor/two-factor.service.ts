import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { encryptTotpSecret, decryptTotpSecret } from '../../../common/crypto/totp-crypto.util';
import { sha256Hex } from '../../../common/crypto/hash.util';

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('app.totpEncryptionKey')!;
  }

  async setup(
    userId: string,
  ): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: 'Nexus', label: user.email, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Store secret temporarily — 2FA is not active until enable() is called
    const encryptedSecret = encryptTotpSecret(secret, this.encryptionKey);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptedSecret },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enable(userId: string, totpCode: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, isTwoFactorEnabled: true },
    });
    if (!user?.twoFactorSecret) throw new BadRequestException('Run 2FA setup first.');
    if (user.isTwoFactorEnabled) throw new ConflictException('2FA is already enabled.');

    const secret = decryptTotpSecret(user.twoFactorSecret, this.encryptionKey);
    if (!(await verifyTotp({ token: totpCode, secret })).valid) {
      throw new UnauthorizedException('Invalid TOTP code.');
    }

    const backupCodes = this.generateBackupCodes();
    const backupCodeHashes = backupCodes.map((c) =>
      this.hashCode(userId, this.normalizeBackupCode(c)),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { isTwoFactorEnabled: true, twoFactorBackupCodes: backupCodeHashes },
    });

    return backupCodes; // Returned once — user must save these immediately
  }

  async disable(userId: string, totpCode: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isTwoFactorEnabled: true },
    });
    if (!user?.isTwoFactorEnabled) throw new BadRequestException('2FA is not enabled.');

    // Delegate to verify() so backup codes are also accepted (e.g., lost authenticator device)
    const isValid = await this.verify(userId, totpCode);
    if (!isValid) throw new UnauthorizedException('Invalid TOTP or backup code.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { isTwoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    });
  }

  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorBackupCodes: true, isTwoFactorEnabled: true },
    });
    if (!user?.isTwoFactorEnabled || !user.twoFactorSecret) return false;

    const secret = decryptTotpSecret(user.twoFactorSecret, this.encryptionKey);
    if ((await verifyTotp({ token: code, secret })).valid) return true;

    // Try backup codes — strip formatting before hashing
    const hash = this.hashCode(userId, this.normalizeBackupCode(code));
    if (!user.twoFactorBackupCodes.includes(hash)) return false;

    // Single-use: remove the matched backup code
    const updated = user.twoFactorBackupCodes.filter((c) => c !== hash);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: updated },
    });
    return true;
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: 10 }, () => {
      const hex = crypto.randomBytes(8).toString('hex').toUpperCase();
      return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`;
    });
  }

  private hashCode(userId: string, code: string): string {
    return sha256Hex(`${userId}:${code}`);
  }

  private normalizeBackupCode(code: string): string {
    return code.replace(/-/g, '').toUpperCase();
  }
}
