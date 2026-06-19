import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { Request, Response } from 'express';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { GraphQLFormattedError } from 'graphql';
import jwt from 'jsonwebtoken';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get('app.nodeEnv') !== 'production';

        return {
          // ── Code-First Schema Generation ────────────────────────────────
          // autoSchemaFile generates the SDL (schema.graphql) automatically.
          // In dev, path: join(process.cwd(), 'src/schema.graphql') writes it to
          // disk for version control and frontend team codegen. In production the
          // runtime image has no src/ directory (and runs as a non-root user that
          // can't create one under /app), so keep the schema in-memory only there.
          autoSchemaFile: isDev ? join(process.cwd(), 'src/schema.graphql') : true,

          // sortSchema: true produces a deterministic schema file, so git diffs
          // don't flip-flop on every build due to definition ordering.
          sortSchema: true,

          // ── Context: The Bridge Between HTTP and GraphQL ──────────────────
          // The context factory runs on every request. Whatever you return here
          // becomes the `context` argument in every resolver and guard.
          // We pass req and res because:
          // - Guards need req.user (populated by Passport)
          // - Auth mutations need to set/clear cookies on res
          // - DataLoaders are per-request (explained below)
          context: ({ req, res }: { req: Request; res: Response }) => ({
            req,
            res,
          }),

          // ── Playground / Landing Page ─────────────────────────────────────
          playground: false, // Disable the legacy playground
          plugins: isDev
            ? [
                ApolloServerPluginLandingPageLocalDefault(), // Apollo Sandbox in dev
                ApolloServerPluginInlineTrace(), // Enables Apollo Studio tracing
              ]
            : [],

          // ── Query Complexity & Depth Limits ──────────────────────────────
          // Without these, a malicious client can craft a deeply nested query
          // that causes exponential DB lookups: { user { friends { friends { friends ... }}}}
          // This is a GraphQL-specific DoS vector that rate limiting alone can't stop.
          // The `graphql-query-complexity` package calculates a complexity score
          // per field and aborts if the total exceeds the limit.
          // We configure this in a plugin (shown separately below).

          // ── Subscriptions ─────────────────────────────────────────────────
          // Subscriptions use WebSockets. We use graphql-ws (not the legacy
          // subscriptions-transport-ws) because it's the current standard.
          subscriptions: {
            'graphql-ws': {
              onConnect: (context: any) => {
                // HTTP Guards don't run for WS — auth is enforced here.
                const { connectionParams } = context;
                const authHeader = connectionParams?.authorization as string | undefined;
                if (!authHeader?.startsWith('Bearer ')) {
                  throw new Error('Unauthorized');
                }
                const token = authHeader.slice(7);
                const secret = config.get<string>('jwt.secret')!;
                let payload: any;
                try {
                  payload = jwt.verify(token, secret);
                } catch {
                  throw new Error('Unauthorized');
                }
                // Pending-2FA tokens must not access subscriptions
                if (payload.scope === 'two_factor_pending') {
                  throw new Error('Unauthorized');
                }
                return { user: payload };
              },
            },
          },

          // ── Error Formatting ──────────────────────────────────────────────
          // This runs AFTER our GlobalExceptionFilter. It's a final safety net
          // to ensure internal errors never leak stack traces in production.
          formatError: (formattedError: GraphQLFormattedError) => {
            if (isDev) return formattedError;

            // Strip stacktrace in production — never expose internals to clients
            const safeExtensions = { ...formattedError.extensions };
            delete safeExtensions.stacktrace;
            return { ...formattedError, extensions: safeExtensions };
          },
        };
      },
    }),
  ],
})
export class GraphQLConfigModule {}
