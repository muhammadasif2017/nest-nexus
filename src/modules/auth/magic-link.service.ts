import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_EMAIL, EmailJobName } from '../../queues/queues.constants';
import { MagicLinkEmailData } from '../../queues/dto/email.job.dto';

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class MagicLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
  ) {}

  async send(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, displayName: true },
    });

    // Always respond 200 — don't reveal whether the email exists
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        magicLinkTokenHash: tokenHash,
        magicLinkExpiresAt: new Date(Date.now() + EXPIRY_MS),
      },
    });

    const clientOrigin = this.config.get<string>('app.clientOrigin');
    const magicLink = `${clientOrigin}/auth/magic-link?token=${token}`;

    await this.emailQueue.add(EmailJobName.MAGIC_LINK, {
      to: email,
      displayName: user.displayName,
      magicLink,
      expiresInMinutes: 15,
    } satisfies MagicLinkEmailData);
  }

  async verify(token: string): Promise<string> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: { magicLinkTokenHash: tokenHash, magicLinkExpiresAt: { gt: new Date() } },
      select: { id: true },
    });

    if (!user) throw new UnauthorizedException('Invalid or expired magic link.');

    // Single-use: clear the token immediately after verification
    await this.prisma.user.update({
      where: { id: user.id },
      data: { magicLinkTokenHash: null, magicLinkExpiresAt: null },
    });

    return user.id;
  }
}
