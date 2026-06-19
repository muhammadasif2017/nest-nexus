export const QUEUE_EMAIL = 'email' as const;

export const DEFAULT_JOB_ATTEMPTS = 3;

export const EMAIL_WORKER_CONCURRENCY = 5;

export const EmailJobName = {
  WELCOME: 'welcome',
  PASSWORD_RESET: 'password-reset',
  EMAIL_VERIFICATION: 'email-verification',
  TWO_FACTOR_CODE: 'two-factor-code',
  MAGIC_LINK: 'magic-link',
} as const;

export type EmailJobName = (typeof EmailJobName)[keyof typeof EmailJobName];
