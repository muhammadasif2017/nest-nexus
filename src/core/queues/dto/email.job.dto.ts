export interface WelcomeEmailData {
  to: string;
  displayName: string;
}

export interface PasswordResetEmailData {
  to: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface EmailVerificationData {
  to: string;
  displayName: string;
  verificationUrl: string;
}

export interface TwoFactorCodeData {
  to: string;
  displayName: string;
  code: string;
  expiresInMinutes: number;
}

export interface MagicLinkEmailData {
  to: string;
  displayName: string;
  magicLink: string;
  expiresInMinutes: number;
}

export type EmailJobData =
  | WelcomeEmailData
  | PasswordResetEmailData
  | EmailVerificationData
  | TwoFactorCodeData
  | MagicLinkEmailData;
