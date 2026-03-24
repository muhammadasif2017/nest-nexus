import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get('app.nodeEnv') !== 'production';
        return {
          pinoHttp: {
            // In development, use pino-pretty for human-readable logs.
            // In production, emit raw JSON so your log aggregator can parse fields
            // like `req.url`, `res.statusCode`, and `responseTime` automatically.
            transport: isDev
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,

            // Log level: 'debug' in dev to see all internals, 'info' in prod
            // to reduce noise and cost in log storage.
            level: isDev ? 'debug' : 'info',

            // ── Redaction ────────────────────────────────────────────────────
            // CRITICAL: These paths are automatically replaced with '[Redacted]'
            // in every log line. Without this, authorization headers, passwords,
            // and tokens will appear in your log aggregator — a serious data leak.
            redact: {
              paths: [
                'req.headers.authorization', // JWT Bearer token
                'req.headers.cookie',          // Session cookie
                'req.body.password',
                'req.body.newPassword',
                'req.body.confirmPassword',
              ],
              censor: '[Redacted]',
            },

            // Attach a unique request ID to every log line emitted during
            // that request's lifecycle. This is how you trace a single user
            // request across 50 log lines without losing context.
            genReqId: (req) => req.headers['x-request-id'] ?? crypto.randomUUID(),

            // Customize what gets logged per request — keep it minimal.
            // Avoid logging large request/response bodies here; use your
            // LoggingInterceptor for that with explicit truncation.
            customLogLevel: (req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },

            serializers: {
              req: (req) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                // Never serialize the full headers object — too noisy, and risky
                userAgent: req.headers['user-agent'],
              }),
              res: (res) => ({
                statusCode: res.statusCode,
              }),
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}