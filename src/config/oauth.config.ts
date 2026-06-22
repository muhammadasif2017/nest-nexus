import { registerAs } from '@nestjs/config';

export default registerAs('oauth', () => ({
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl:
    process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3000/api/v1/auth/google/callback',
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  githubCallbackUrl:
    process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:3000/api/v1/auth/github/callback',
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  microsoftCallbackUrl:
    process.env.MICROSOFT_CALLBACK_URL ?? 'http://localhost:3000/api/v1/auth/microsoft/callback',
}));
