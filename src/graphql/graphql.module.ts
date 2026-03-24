import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { Request, Response } from 'express';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';

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
          // path: join(process.cwd(), 'src/schema.graphql') writes it to disk,
          // which is useful for version control and frontend team codegen.
          // Set to `true` to keep the schema in-memory only.
          autoSchemaFile: join(process.cwd(), 'src/schema.graphql'),

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
                ApolloServerPluginInlineTrace(),             // Enables Apollo Studio tracing
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
                // Authentication for WebSocket connections happens here.
                // HTTP Guards don't run for WS connections — you must handle
                // auth manually in onConnect.
                const { connectionParams } = context;
                if (connectionParams?.authorization) {
                  // Validate the token and attach user to context
                  // (call your JwtStrategy.validate() logic here)
                }
              },
            },
          },

          // ── Error Formatting ──────────────────────────────────────────────
          // This runs AFTER our GlobalExceptionFilter. It's a final safety net
          // to ensure internal errors never leak stack traces in production.
          formatError: (formattedError, error) => {
            // The original error is the raw exception; formattedError is what
            // Apollo has already processed. We augment it, not replace it.
            if (isDev) {
              // In dev, include the originalError for stack traces in the playground
              return formattedError;
            }

            // In production, strip extensions we don't want clients to see
            const { stacktrace, ...safeExtensions } = formattedError.extensions ?? {};
            return { ...formattedError, extensions: safeExtensions };
          },
        };
      },
    }),
  ],
})
export class GraphQLConfigModule {}