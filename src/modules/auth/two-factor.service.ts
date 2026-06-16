import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TwoFactorService {
  constructor(private readonly prisma: PrismaService) {}

  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Nexus', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Store secret temporarily — 2FA is not active until enable() is called
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enable(userId: string, totpCode: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, isTwoFactorEnabled: true },
    });
    if (!user?.twoFactorSecret) throw new BadRequestException('Run 2FA setup first.');
    if (user.isTwoFactorEnabled) throw new ConflictException('2FA is already enabled.');

    if (!authenticator.verify({ token: totpCode, secret: user.twoFactorSecret })) {
      throw new UnauthorizedException('Invalid TOTP code.');
    }

    const backupCodes = this.generateBackupCodes();
    const backupCodeHashes = backupCodes.map((c) => this.hashCode(userId, c));

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

    if (authenticator.verify({ token: code, secret: user.twoFactorSecret })) return true;

    // Try backup codes — strip formatting before hashing
    const hash = this.hashCode(userId, code.replace(/-/g, '').toUpperCase());
    if (!user.twoFactorBackupCodes.includes(hash)) return false;

    // Single-use: remove the matched backup code
    const updated = user.twoFactorBackupCodes.filter((c) => c !== hash);
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorBackupCodes: updated } });
    return true;
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: 10 }, () => {
      const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
      return `${hex.slice(0, 4)}-${hex.slice(4)}`;
    });
  }

  private hashCode(userId: string, code: string): string {
    return crypto.createHash('sha256').update(userId + ':' + code).digest('hex');
  }
}
