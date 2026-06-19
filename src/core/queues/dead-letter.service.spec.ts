import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { DeadLetterService } from './dead-letter.service';

const makeJob = (overrides: Record<string, unknown> = {}): Job =>
  ({
    id: 'job-1',
    name: 'welcome-email',
    queueName: 'email',
    attemptsMade: 3,
    data: { to: 'user@test.com', token: 'super-secret-token' },
    ...overrides,
  }) as unknown as Job;

const makeConfigMock = (webhookUrl?: string) => ({
  get: jest.fn().mockReturnValue(webhookUrl),
});

const makeService = (webhookUrl?: string) => {
  const config = makeConfigMock(webhookUrl);
  const service = new DeadLetterService(config as unknown as ConfigService);
  return { service, config };
};

describe('DeadLetterService', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleFailedJob()', () => {
    it('logs an error with queue, jobId, jobName, attemptsMade, and failedReason', async () => {
      const { service } = makeService();
      const job = makeJob();
      const error = new Error('SMTP timeout');
      await service.handleFailedJob(job, error);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: 'email',
          jobId: 'job-1',
          jobName: 'welcome-email',
          attemptsMade: 3,
          failedReason: 'SMTP timeout',
        }),
        expect.stringContaining('Dead-letter'),
      );
    });

    it('does not include job.data in the logged payload', async () => {
      const { service } = makeService();
      await service.handleFailedJob(makeJob(), new Error('fail'));
      const [loggedPayload] = errorSpy.mock.calls[0];
      expect(loggedPayload).not.toHaveProperty('data');
      expect(JSON.stringify(loggedPayload)).not.toContain('super-secret-token');
    });

    it('does not call fetch when no webhook URL is configured', async () => {
      const { service } = makeService(undefined);
      await service.handleFailedJob(makeJob(), new Error('fail'));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POSTs to the webhook URL when configured', async () => {
      const { service } = makeService('https://hooks.example.com/alert');
      await service.handleFailedJob(makeJob(), new Error('fail'));
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://hooks.example.com/alert',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('includes job name, queue name, and error message in the webhook body', async () => {
      const { service } = makeService('https://hooks.example.com/alert');
      await service.handleFailedJob(makeJob(), new Error('SMTP timeout'));
      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.text).toContain('welcome-email');
      expect(body.text).toContain('email');
      expect(body.attachments[0].text).toBe('SMTP timeout');
    });

    it('does not throw when the webhook request fails', async () => {
      const { service } = makeService('https://hooks.example.com/alert');
      fetchSpy.mockRejectedValue(new Error('network error'));
      await expect(service.handleFailedJob(makeJob(), new Error('fail'))).resolves.toBeUndefined();
    });

    it('logs a warning when the webhook request fails', async () => {
      const { service } = makeService('https://hooks.example.com/alert');
      fetchSpy.mockRejectedValue(new Error('network error'));
      await service.handleFailedJob(makeJob(), new Error('fail'));
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
