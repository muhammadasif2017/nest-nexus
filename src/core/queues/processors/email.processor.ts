import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import {
  QUEUE_EMAIL,
  EmailJobName,
  DEFAULT_JOB_ATTEMPTS,
  EMAIL_WORKER_CONCURRENCY,
} from '../queues.constants';
import {
  EmailJobData,
  WelcomeEmailData,
  PasswordResetEmailData,
  EmailVerificationData,
  TwoFactorCodeData,
  MagicLinkEmailData,
} from '../dto/email.job.dto';
import { DeadLetterService } from '../dead-letter.service';
import { MailerService } from '../../mailer/mailer.service';

// displayName is user-supplied — must be escaped before going into HTML email bodies.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Processor(QUEUE_EMAIL, { concurrency: EMAIL_WORKER_CONCURRENCY })
export class EmailProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly deadLetter: DeadLetterService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.worker.concurrency = this.config.get<number>(
      'app.emailWorkerConcurrency',
      EMAIL_WORKER_CONCURRENCY,
    );
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(`Processing email job "${job.name}" (id=${job.id})`);

    switch (job.name as EmailJobName) {
      case EmailJobName.WELCOME:
        return this.sendWelcome(job.data as WelcomeEmailData);
      case EmailJobName.PASSWORD_RESET:
        return this.sendPasswordReset(job.data as PasswordResetEmailData);
      case EmailJobName.EMAIL_VERIFICATION:
        return this.sendEmailVerification(job.data as EmailVerificationData);
      case EmailJobName.TWO_FACTOR_CODE:
        return this.sendTwoFactorCode(job.data as TwoFactorCodeData);
      case EmailJobName.MAGIC_LINK:
        return this.sendMagicLink(job.data as MagicLinkEmailData);
      default:
        throw new Error(`Unknown email job name: ${job.name}`);
    }
  }

  // Called by BullMQ on every failed attempt (not only the final one).
  // job.opts.attempts is undefined when the job inherits defaultJobOptions,
  // so fall back to DEFAULT_JOB_ATTEMPTS which matches queues.module.ts.
  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJobData> | undefined, error: Error): void {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS;
    if (job.attemptsMade >= maxAttempts) {
      void this.deadLetter.handleFailedJob(job, error);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<EmailJobData>): void {
    this.logger.log(`Email job "${job.name}" (id=${job.id}) completed`);
  }

  // ── Private senders ────────────────────────────────────────────────────────
  // Only sendMagicLink is wired to real SMTP (MailerService) so far — the rest
  // stay stub logs until the equivalent wiring lands for them.

  private async sendWelcome(data: WelcomeEmailData): Promise<void> {
    this.logger.log(`[STUB] Welcome email → ${data.to} (${data.displayName})`);
  }

  private async sendPasswordReset(data: PasswordResetEmailData): Promise<void> {
    this.logger.log(
      `[STUB] Password-reset email → ${data.to}, expires in ${data.expiresInMinutes}m`,
    );
  }

  private async sendEmailVerification(data: EmailVerificationData): Promise<void> {
    this.logger.log(`[STUB] Verification email → ${data.to}`);
  }

  private async sendTwoFactorCode(data: TwoFactorCodeData): Promise<void> {
    this.logger.log(
      `[STUB] 2FA code email → ${data.to}, code expires in ${data.expiresInMinutes}m`,
    );
  }

  private async sendMagicLink(data: MagicLinkEmailData): Promise<void> {
    if (!this.mailer.isConfigured) {
      this.logger.log(`[STUB] Magic link email → ${data.to}, expires in ${data.expiresInMinutes}m`);
      return;
    }
    await this.mailer.send({
      to: data.to,
      subject: 'Your nest-nexus login link',
      text:
        `Hi ${data.displayName},\n\n` +
        `Click to log in: ${data.magicLink}\n\n` +
        `This link expires in ${data.expiresInMinutes} minutes and can only be used once.`,
      html:
        `<p>Hi ${escapeHtml(data.displayName)},</p>` +
        `<p><a href="${data.magicLink}">Click to log in</a></p>` +
        `<p>This link expires in ${data.expiresInMinutes} minutes and can only be used once.</p>`,
    });
  }
}
