import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_EMAIL, DEFAULT_JOB_ATTEMPTS } from './queues.constants';
import { DeadLetterService } from './dead-letter.service';
import { EmailProcessor } from './processors/email.processor';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    MailerModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string | undefined>('redis.password'),
        },
        defaultJobOptions: {
          attempts: DEFAULT_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_EMAIL }),
  ],
  providers: [DeadLetterService, EmailProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
