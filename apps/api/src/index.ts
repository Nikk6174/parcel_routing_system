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
  const { connectToDatabase } = await import('./db/client.js');

  // Connect to MongoDB
  const { db, client } = await connectToDatabase(config.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const app = await createApp(config, db);

  // Graceful shutdown: flush Sentry events before exiting
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully…`);
    await app.close();
    await client.close();
    await flushSentry();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err: unknown) {
    app.log.error(err, 'Failed to start server');
    await client.close();
    await flushSentry();
    process.exit(1);
  }

  // ── Start pipeline orchestrator ─────────────────────
  const { ParcelRepository } = await import('./db/parcel-repository.js');
  const { OutcomeRepository } = await import('./db/outcome-repository.js');
  const { RuleRepository } = await import('./db/rule-repository.js');
  const { PipelineOrchestrator } = await import('./pipeline/orchestrator.js');
  const { DEFAULT_PIPELINE_CONFIG } = await import('./pipeline/types.js');
  const evaluateParcel = (await import('./pipeline/worker.js')).default;

  const parcelRepo = new ParcelRepository(db);
  const outcomeRepo = new OutcomeRepository(db);
  const ruleRepo = new RuleRepository(db);

  // In-process worker pool (synchronous, dev-friendly — no Piscina build needed)
  const workerPool = {
    async run(data: import('./pipeline/types.js').WorkerInput) {
      return evaluateParcel(data);
    },
    async destroy() { /* no-op for inline pool */ },
  };

  const orchestrator = new PipelineOrchestrator(
    parcelRepo,
    outcomeRepo,
    ruleRepo,
    workerPool,
    DEFAULT_PIPELINE_CONFIG,
    {
      info: (msg, ctx) => app.log.info(ctx ?? {}, msg),
      warn: (msg, ctx) => app.log.warn(ctx ?? {}, msg),
      error: (msg, ctx) => app.log.error(ctx ?? {}, msg),
    },
    config.SENTRY_CRON_SLUG,
  );

  await orchestrator.start();
  console.log('✅ Pipeline orchestrator started');
}

main().catch(async (err: unknown) => {
  console.error('Fatal error during startup:', err);
  await flushSentry();
  process.exit(1);
});
