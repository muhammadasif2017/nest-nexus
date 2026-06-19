import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);
  private readonly webhookUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.webhookUrl = config.get<string>('app.alertsWebhookUrl');
  }

  async handleFailedJob(job: Job, error: Error): Promise<void> {
    // job.data is intentionally excluded — it may contain tokens, emails, or other PII.
    const payload = {
      queue: job.queueName,
      jobId: job.id,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: error.message,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      { ...payload, stack: error.stack },
      `Dead-letter: job "${job.name}" (id=${job.id}) exhausted retries in queue "${job.queueName}"`,
    );

    if (this.webhookUrl) {
      try {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 Dead-letter job: *${job.name}* in queue *${job.queueName}*`,
            attachments: [{ text: error.message, color: 'danger' }],
            payload,
          }),
        });
      } catch (webhookErr) {
        // Swallow webhook errors — job failure is already logged above
        this.logger.warn({ err: webhookErr }, 'Dead-letter webhook delivery failed');
      }
    }
  }
}
