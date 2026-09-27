/**
 * Server entry point.
 *
 * Sentry is initialized FIRST (before Fastify, MongoDB, etc.)
 * so all modules are auto-instrumented.
 */
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { loadConfig } from './config/env.js';
import { initSentry, flushSentry } from './observability/index.js';

/*
 * Load .env files before reading config.
 *
 * When CWD is apps/api (npm workspace scripts), ../../.env reaches the
 * monorepo root. The second call is a CWD fallback for other workflows.
 * dotenv never overrides an already-set variable, so root values win.
 */
dotenv.config({ path: resolve('../../.env') });
dotenv.config();

async function main(): Promise<void> {
  // Fails fast with a human-readable error if any env var is bad.
  const config = loadConfig();

  // Initialize Sentry BEFORE creating Fastify/MongoDB so auto-instrumentation
  // hooks into those modules. If SENTRY_DSN is missing, this logs a WARN and
  // disables Sentry — the app runs normally.
  initSentry(config);

  // Dynamic import AFTER Sentry init so Fastify is instrumented.
  const { createApp } = await import('./app.js');

  const app = createApp(config);

  // Graceful shutdown: flush Sentry events before exiting
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully…`);
    await app.close();
    await flushSentry();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err: unknown) {
    app.log.error(err, 'Failed to start server');
    await flushSentry();
    process.exit(1);
  }
}

main().catch(async (err: unknown) => {
  console.error('Fatal error during startup:', err);
  await flushSentry();
  process.exit(1);
});
