export const QUEUE_EMAIL = 'email';

export const EmailJobName = {
  WELCOME: 'welcome',
  PASSWORD_RESET: 'password-reset',
  EMAIL_VERIFICATION: 'email-verification',
  TWO_FACTOR_CODE: 'two-factor-code',
  MAGIC_LINK: 'magic-link',
} as const;

export type EmailJobName = (typeof EmailJobName)[keyof typeof EmailJobName];
