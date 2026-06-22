import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

jest.mock('nodemailer');

// ── Factories ─────────────────────────────────────────────────────────────────

const makeConfigMock = (overrides: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    'smtp.host': undefined,
    'smtp.port': 587,
    'smtp.secure': false,
    'smtp.user': 'user',
    'smtp.pass': 'pass',
    'smtp.from': 'Nexus <no-reply@example.com>',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
};

describe('MailerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is not configured when SMTP_HOST is unset', () => {
    const config = makeConfigMock();
    const mailer = new MailerService(config as unknown as ConfigService);
    mailer.onModuleInit();

    expect(mailer.isConfigured).toBe(false);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('builds a transporter with config values when SMTP_HOST is set', () => {
    const config = makeConfigMock({ 'smtp.host': 'smtp.example.com', 'smtp.secure': true });
    const mailer = new MailerService(config as unknown as ConfigService);
    mailer.onModuleInit();

    expect(mailer.isConfigured).toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      auth: { user: 'user', pass: 'pass' },
    });
  });

  it('skips sending and logs a warning when not configured', async () => {
    const config = makeConfigMock();
    const mailer = new MailerService(config as unknown as ConfigService);
    mailer.onModuleInit();

    await mailer.send({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' });

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('sends via the transporter with the configured "from" address', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    const config = makeConfigMock({ 'smtp.host': 'smtp.example.com' });
    const mailer = new MailerService(config as unknown as ConfigService);
    mailer.onModuleInit();

    await mailer.send({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Nexus <no-reply@example.com>',
      to: 'a@b.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
  });
});
