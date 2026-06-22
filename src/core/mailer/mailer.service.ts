import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string | undefined>('smtp.host');
    if (!host) return; // No SMTP configured — callers fall back to logging the intent.

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('smtp.port'),
      secure: this.config.get<boolean>('smtp.secure'),
      auth: {
        user: this.config.get<string>('smtp.user'),
        pass: this.config.get<string>('smtp.pass'),
      },
    });
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(options: SendMailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — skipping send to ${options.to}`);
      return;
    }
    // Intentionally not caught here — let it propagate to the BullMQ job so the
    // existing retry/backoff + dead-letter pipeline (queues.module.ts) handles failures.
    await this.transporter.sendMail({
      from: this.config.get<string>('smtp.from'),
      ...options,
    });
  }
}
