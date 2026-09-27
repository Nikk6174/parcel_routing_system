import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { type Db } from 'mongodb';
import type { EnvConfig } from './config/env.js';
import { initJwtSecret } from './security/index.js';

// ── Orchestrator heartbeat tracking ─────────────────────
let lastTickTimestamp = 0;

/** Called by the orchestrator after each tick. */
export function recordOrchestratorTick(): void {
  lastTickTimestamp = Date.now();
}

/** Get the timestamp of the last orchestrator tick. */
export function getLastTickTimestamp(): number {
  return lastTickTimestamp;
}
import {
  ParcelRepository,
  OutcomeRepository,
  RuleRepository,
  IdempotencyRepository,
  ensureIndexes,
} from './db/index.js';
import { parcelRoutes } from './routes/parcel-routes.js';
import { batchRoutes } from './routes/batch-routes.js';
import { ruleRoutes } from './routes/rule-routes.js';
import { approvalRoutes } from './routes/approval-routes.js';

/**
 * Create and configure a Fastify application instance.
 *
 * Accepts EITHER a full EnvConfig (production startup) OR a plain Db
 * handle (for testing without a full config).
 */
export async function createApp(config: EnvConfig, db?: Db): Promise<FastifyInstance> {
  // Initialize JWT verification key from config.
  initJwtSecret(config.JWT_SECRET);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  /**
   * Security headers via @fastify/helmet.
   *
   * HTTPS ENFORCEMENT NOTE:
   * TLS termination is handled at the load balancer / reverse proxy level
   * (e.g. AWS ALB, nginx, Cloudflare). This app listens on plain HTTP
   * behind the proxy. The Strict-Transport-Security header (HSTS) set by
   * helmet tells browsers to always use HTTPS for future requests.
   */
  await app.register(helmet, {
    contentSecurityPolicy: false, // CSP managed by the frontend, not API
  });

  /**
   * Rate limiting: per-IP by default (in-memory store).
   *
   * PRODUCTION NOTE — WHY REDIS:
   * The in-memory store only works for a single server instance. If you
   * scale to multiple instances behind a load balancer, each instance
   * tracks its own counters independently — a client could hit N instances
   * and get N × max requests. Use @fastify/rate-limit's Redis store
   * (`store: new RedisStore(...)`) for shared state across instances.
   *
   * Example with Redis:
   *   import RedisStore from '@fastify/rate-limit/store/redis';
   *   store: new RedisStore({ client: redisClient })
   */
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
    addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
  });

  // ── Correlation ID header ──────────────────────────────
  // Return the Fastify request id as x-correlation-id in every response.
  // This lets operators trace a request through logs and Sentry.
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-correlation-id', request.id);
  });

  /**
   * Health-check endpoint — always returns 200.
   * Used by load balancers, container orchestrators, and smoke tests.
   * No auth required — must be accessible for health probes.
   */
  app.get('/health', async () => {
    return { status: 'ok' as const };
  });

  /**
   * Readiness endpoint — returns 200 only if ALL checks pass:
   * 1. MongoDB responds to a ping.
   * 2. The orchestrator's last tick is within the staleness window.
   *
   * Returns 503 with a JSON body naming the failing check(s) otherwise.
   * Used by Kubernetes readiness probes and Sentry uptime monitors.
   */
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};

    // Check 1: MongoDB ping
    try {
      const dbHandle = (app as unknown as { mongo?: { db?: Db } }).mongo?.db ?? db;
      if (dbHandle) {
        await dbHandle.command({ ping: 1 });
      } else {
        checks['mongodb'] = 'No database connection available';
      }
    } catch (err: unknown) {
      checks['mongodb'] = err instanceof Error ? err.message : 'MongoDB ping failed';
    }

    // Check 2: Orchestrator heartbeat freshness
    const staleness = config.READY_STALENESS_MS;
    const lastTick = lastTickTimestamp;
    if (lastTick === 0) {
      // Orchestrator hasn't started yet — acceptable during startup grace period
      // but once it should be running, this is a problem
    } else {
      const age = Date.now() - lastTick;
      if (age > staleness) {
        checks['orchestrator'] = `Last tick was ${Math.round(age / 1000)}s ago (threshold: ${Math.round(staleness / 1000)}s)`;
      }
    }

    if (Object.keys(checks).length > 0) {
      return reply.status(503).send({
        status: 'error' as const,
        checks,
      });
    }

    return { status: 'ok' as const };
  });

  // If a DB handle was provided, register routes before returning.
  if (db) {
    await registerRoutes(app, db);
  }

  return app;
}

/**
 * Create a fully-wired app with DB connection for testing.
 * Uses a test-safe JWT secret for token generation in tests.
 */
export const TEST_JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

export async function createTestApp(db: Db): Promise<FastifyInstance> {
  const config: EnvConfig = {
    PORT: 3001,
    MONGO_URI: 'memory://test',
    LOG_LEVEL: 'error',
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    JWT_SECRET: TEST_JWT_SECRET,
    // Phase 8 observability — Sentry disabled in tests
    SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: 'test',
    SENTRY_TRACES_SAMPLE_RATE: 0,
    SENTRY_CRON_SLUG: 'test-heartbeat',
    DRIFT_CHECK_INTERVAL_MS: 300_000,
    DRIFT_Z_THRESHOLD: 2.0,
    DRIFT_MIN_SAMPLE: 30,
    READY_STALENESS_MS: 60_000,
  };

  const app = Fastify({ logger: { level: 'error' } });

  initJwtSecret(config.JWT_SECRET);

  // Helmet and rate-limit for test consistency
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });

  // Correlation ID header for test consistency
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-correlation-id', request.id);
  });

  app.get('/health', async () => ({ status: 'ok' as const }));

  // /ready endpoint (same logic as production)
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};

    try {
      await db.command({ ping: 1 });
    } catch (err: unknown) {
      checks['mongodb'] = err instanceof Error ? err.message : 'MongoDB ping failed';
    }

    const lastTick = lastTickTimestamp;
    if (lastTick > 0) {
      const age = Date.now() - lastTick;
      if (age > config.READY_STALENESS_MS) {
        checks['orchestrator'] = `Last tick was ${Math.round(age / 1000)}s ago (threshold: ${Math.round(config.READY_STALENESS_MS / 1000)}s)`;
      }
    }

    if (Object.keys(checks).length > 0) {
      return reply.status(503).send({ status: 'error' as const, checks });
    }
    return { status: 'ok' as const };
  });

  await registerRoutes(app, db);
  return app;
}

async function registerRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // Register multipart plugin (50 MB max file size)
  await app.register(multipart, {
    limits: { fileSize: 50_000_000 },
  });

  // Ensure DB indexes (idempotent — safe on every startup)
  await ensureIndexes(db);

  // Create repositories
  const parcelRepo = new ParcelRepository(db);
  const outcomeRepo = new OutcomeRepository(db);
  const ruleRepo = new RuleRepository(db);
  const idempotencyRepo = new IdempotencyRepository(db);
  await idempotencyRepo.ensureIndex();

  // Register routes
  await app.register(parcelRoutes, { parcelRepo, outcomeRepo, idempotencyRepo });
  await app.register(batchRoutes, { parcelRepo, idempotencyRepo });
  await app.register(ruleRoutes, { ruleRepo });
  await app.register(approvalRoutes, { parcelRepo });
}
