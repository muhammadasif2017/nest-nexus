import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisLockService } from '../redis-lock.service';

@Injectable()
export class CleanupScheduler {
  private readonly logger = new Logger(CleanupScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: RedisLockService,
  ) {}

  // Runs at the top of every hour on all instances.
  // Redis lock ensures only ONE instance actually does the work.
  // TTL of 300s (5 min) — more than enough for the cleanup to finish.
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredTokens(): Promise<void> {
    await this.lock.withLock(
      'cleanup:expired-tokens',
      async () => {
        const now = new Date();

        const [refreshResult, magicLinkResult, verificationResult] = await Promise.all([
          // Expired or revoked refresh tokens
          this.prisma.refreshToken.deleteMany({
            where: { OR: [{ expiresAt: { lt: now } }, { isRevoked: true }] },
          }),
          // Expired magic link tokens
          this.prisma.user.updateMany({
            where: { magicLinkExpiresAt: { lt: now }, magicLinkTokenHash: { not: null } },
            data: { magicLinkTokenHash: null, magicLinkExpiresAt: null },
          }),
          // Expired email verification tokens
          this.prisma.user.updateMany({
            where: { emailVerificationExpires: { lt: now }, emailVerificationToken: { not: null } },
            data: { emailVerificationToken: null, emailVerificationExpires: null },
          }),
        ]);

        this.logger.log(
          `Cleanup complete — refreshTokens: ${refreshResult.count}, ` +
            `magicLinks: ${magicLinkResult.count}, emailVerifications: ${verificationResult.count}`,
        );
      },
      300,
    );
  }

  // Runs daily at 03:00 — purge OAuth providers for deleted/deactivated users
  @Cron('0 3 * * *')
  async purgeOrphanedOauthProviders(): Promise<void> {
    await this.lock.withLock(
      'cleanup:orphaned-oauth',
      async () => {
        const result = await this.prisma.oauthProvider.deleteMany({
          where: { user: { isActive: false } },
        });
        if (result.count > 0) {
          this.logger.log(`Purged ${result.count} orphaned OAuth providers for deactivated users`);
        }
      },
      60,
    );
  }
}
