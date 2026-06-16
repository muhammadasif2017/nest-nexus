import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  poolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  sessionPoolMax: parseInt(process.env.DATABASE_SESSION_POOL_MAX || '5', 10),
}));
