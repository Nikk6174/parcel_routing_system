import { z } from 'zod';

/**
 * Zod schema for environment-level configuration.
 *
 * All values arrive as strings from process.env; `z.coerce` converts numeric
 * fields. Required fields have no default and will cause a parse failure if
 * missing. Optional fields carry sensible defaults.
 */
const envSchema = z.object({
  /** Port the Fastify server listens on. */
  PORT: z.coerce.number().int().positive().default(3001),

  /** MongoDB connection string. REQUIRED — no default. */
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  /** Pino log level for the Fastify logger. */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Maximum number of requests per rate-limit window. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  /** Rate-limit window duration in milliseconds. */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Secret key for HS256 JWT verification.
   * MUST be at least 32 characters.
   *
   * PRODUCTION NOTE: In production, prefer JWKS (asymmetric keys from an IdP)
   * over a shared symmetric secret. Set JWT_SECRET only for development or
   * when you control both the token issuer and this service.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // ── Observability (Phase 8) ────────────────────────────

  /** Sentry DSN. If omitted, Sentry is disabled and the app runs normally. */
  SENTRY_DSN: z.string().url().optional(),

  /** Sentry environment tag (e.g. 'production', 'staging', 'development'). */
  SENTRY_ENVIRONMENT: z.string().default('development'),

  /** Sentry traces sample rate (0.0–1.0). */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  /** Sentry cron monitor slug for orchestrator heartbeat. */
  SENTRY_CRON_SLUG: z.string().default('orchestrator-heartbeat'),

  // ── Drift detection ────────────────────────────────────

  /** How often to run the routing drift check (ms). */
  DRIFT_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  /** Z-score threshold for flagging a department. */
  DRIFT_Z_THRESHOLD: z.coerce.number().positive().default(2.0),

  /** Minimum parcels in the 1-hour window to run the check. */
  DRIFT_MIN_SAMPLE: z.coerce.number().int().positive().default(30),

  // ── Readiness ──────────────────────────────────────────

  /** Max ms since last orchestrator tick before /ready returns 503. */
  READY_STALENESS_MS: z.coerce.number().int().positive().default(60_000),

  // ── CORS ───────────────────────────────────────────────

  /** Allowed CORS origin(s). Defaults to '*' (any). Set to frontend URL in production. */
  CORS_ORIGIN: z.string().default('*'),
});

/** Typed configuration object derived from environment variables. */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate and return typed configuration from the given environment.
 *
 * @param env - An object shaped like `process.env`. Defaults to the real
 *              process environment, but accepts overrides for testing.
 * @returns    Validated, typed configuration.
 * @throws     Error if any required variable is missing or invalid.
 *             The error message enumerates every validation failure.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): EnvConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    const message = [
      '',
      '❌  Invalid environment configuration:',
      errors,
      '',
      'See .env.example for required variables.',
      '',
    ].join('\n');

    console.error(message);
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}
