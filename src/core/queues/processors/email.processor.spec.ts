import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { DeadLetterService } from '../dead-letter.service';
import { EmailJobName, DEFAULT_JOB_ATTEMPTS } from '../queues.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

const makeJob = (overrides: Record<string, unknown> = {}): Job =>
  ({
    id: 'job-1',
    name: EmailJobName.WELCOME,
    data: { to: 'user@test.com', displayName: 'Test User' },
    attemptsMade: 1,
    opts: {},
    queueName: 'email',
    ...overrides,
  }) as unknown as Job;

const makeDeadLetterMock = () => ({ handleFailedJob: jest.fn().mockResolvedValue(undefined) });
const makeConfigMock = () => ({ get: jest.fn().mockReturnValue(5) });

const makeProcessor = () => {
  const deadLetter = makeDeadLetterMock();
  const config = makeConfigMock();
  const processor = new EmailProcessor(
    deadLetter as unknown as DeadLetterService,
    config as unknown as ConfigService,
  );
  return { processor, deadLetter, config };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('EmailProcessor', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  // ── process() job routing ───────────────────────────────────────────────────

  describe('process()', () => {
    it('routes WELCOME job to sendWelcome without throwing', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({
        name: EmailJobName.WELCOME,
        data: { to: 'a@test.com', displayName: 'A' },
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('routes PASSWORD_RESET job to sendPasswordReset without throwing', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({
        name: EmailJobName.PASSWORD_RESET,
        data: { to: 'a@test.com', displayName: 'A', resetUrl: 'http://x', expiresInMinutes: 15 },
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('routes EMAIL_VERIFICATION job to sendEmailVerification without throwing', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({
        name: EmailJobName.EMAIL_VERIFICATION,
        data: { to: 'a@test.com', displayName: 'A', verificationUrl: 'http://x' },
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('routes TWO_FACTOR_CODE job to sendTwoFactorCode without throwing', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({
        name: EmailJobName.TWO_FACTOR_CODE,
        data: { to: 'a@test.com', displayName: 'A', code: '123456', expiresInMinutes: 5 },
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('routes MAGIC_LINK job to sendMagicLink without throwing', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({
        name: EmailJobName.MAGIC_LINK,
        data: { to: 'a@test.com', displayName: 'A', magicLink: 'http://x', expiresInMinutes: 15 },
      });
      await expect(processor.process(job)).resolves.toBeUndefined();
    });

    it('throws for an unknown job name', async () => {
      const { processor } = makeProcessor();
      const job = makeJob({ name: 'unknown-job-type' });
      await expect(processor.process(job)).rejects.toThrow(
        'Unknown email job name: unknown-job-type',
      );
    });
  });

  // ── onFailed() dead-letter routing ──────────────────────────────────────────

  describe('onFailed()', () => {
    it('calls deadLetter.handleFailedJob when attemptsMade reaches job.opts.attempts', () => {
      const { processor, deadLetter } = makeProcessor();
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      const error = new Error('send failed');
      processor.onFailed(job, error);
      expect(deadLetter.handleFailedJob).toHaveBeenCalledWith(job, error);
    });

    it('calls deadLetter.handleFailedJob using DEFAULT_JOB_ATTEMPTS when opts.attempts is undefined', () => {
      const { processor, deadLetter } = makeProcessor();
      const job = makeJob({ attemptsMade: DEFAULT_JOB_ATTEMPTS, opts: {} });
      processor.onFailed(job, new Error('send failed'));
      expect(deadLetter.handleFailedJob).toHaveBeenCalledTimes(1);
    });

    it('does not call deadLetter.handleFailedJob on a non-final attempt', () => {
      const { processor, deadLetter } = makeProcessor();
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      processor.onFailed(job, new Error('send failed'));
      expect(deadLetter.handleFailedJob).not.toHaveBeenCalled();
    });

    it('is a no-op when job is undefined', () => {
      const { processor, deadLetter } = makeProcessor();
      expect(() => processor.onFailed(undefined, new Error('send failed'))).not.toThrow();
      expect(deadLetter.handleFailedJob).not.toHaveBeenCalled();
    });
  });

  // ── onCompleted() ────────────────────────────────────────────────────────────

  describe('onCompleted()', () => {
    it('does not throw when called with a completed job', () => {
      const { processor } = makeProcessor();
      const job = makeJob();
      expect(() => processor.onCompleted(job)).not.toThrow();
    });
  });
});
