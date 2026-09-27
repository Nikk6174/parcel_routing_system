/**
 * Sentry SDK bootstrap.
 *
 * MUST be imported before any other module so that Fastify, MongoDB,
 * and Node.js built-ins are auto-instrumented by Sentry's hooks.
 *
 * If SENTRY_DSN is not set, Sentry is disabled and the app runs normally.
 */
import * as Sentry from '@sentry/node';
import { execSync } from 'node:child_process';
import type { EnvConfig } from '../config/env.js';

let sentryEnabled = false;

/**
 * Get the current git SHA for the Sentry release tag.
 * Falls back to 'unknown' if git is not available.
 */
function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Initialize Sentry with the given config.
 * Must be called once, before Fastify and MongoDB clients are created.
 *
 * @param config The validated env config.
 * @param logger A minimal logger (console before Fastify is ready).
 */
export function initSentry(
  config: EnvConfig,
  logger: { warn: (msg: string) => void; info: (msg: string) => void } = console,
): void {
  if (!config.SENTRY_DSN) {
    logger.warn(
      'SENTRY_DSN not set — Sentry is disabled. Errors, traces, and metrics will not be reported.',
    );
    sentryEnabled = false;
    return;
  }

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    release: `parcel-routing@${getGitSha()}`,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,

    // Redact sensitive data from breadcrumbs and events
    beforeBreadcrumb(breadcrumb) {
      // Redact authorization headers from HTTP breadcrumbs
      if (breadcrumb.category === 'http' && breadcrumb.data) {
        delete breadcrumb.data['authorization'];
        delete breadcrumb.data['Authorization'];
      }
      return breadcrumb;
    },

    beforeSend(event) {
      // Redact sensitive request headers
      if (event.request?.headers) {
        if (event.request.headers['authorization']) {
          event.request.headers['authorization'] = '[REDACTED]';
        }
        if (event.request.headers['cookie']) {
          event.request.headers['cookie'] = '[REDACTED]';
        }
      }
      return event;
    },
  });

  sentryEnabled = true;
  logger.info(`Sentry initialized (env=${config.SENTRY_ENVIRONMENT}, release=${getGitSha()})`);
}

/** Whether Sentry is active (DSN was provided and init succeeded). */
export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

/**
 * Flush pending Sentry events before process exit.
 * Called during graceful shutdown.
 */
export async function flushSentry(timeoutMs = 5000): Promise<void> {
  if (sentryEnabled) {
    await Sentry.flush(timeoutMs);
  }
}

/**
 * Capture an exception in Sentry with parcel-specific tags.
 * Only sends to Sentry if enabled; always safe to call.
 */
export function captureParcelError(
  error: Error | string,
  tags: {
    correlationId?: string;
    parcelId?: string;
    batchId?: string | null;
    ruleVersion?: number | null;
  },
): void {
  if (!sentryEnabled) return;

  Sentry.withScope((scope) => {
    if (tags.correlationId) scope.setTag('correlationId', tags.correlationId);
    if (tags.parcelId) scope.setTag('parcelId', tags.parcelId);
    if (tags.batchId) scope.setTag('batchId', tags.batchId);
    if (tags.ruleVersion != null) scope.setTag('ruleVersion', String(tags.ruleVersion));

    if (typeof error === 'string') {
      Sentry.captureMessage(error, 'error');
    } else {
      Sentry.captureException(error);
    }
  });
}

/**
 * Send a Sentry cron check-in for the orchestrator heartbeat.
 */
export function cronCheckIn(
  slug: string,
  status: 'in_progress' | 'ok' | 'error',
  checkInId?: string,
): string | undefined {
  if (!sentryEnabled) return undefined;
  if (status === 'in_progress') {
    return Sentry.captureCheckIn({
      monitorSlug: slug,
      status: 'in_progress',
    });
  }
  return Sentry.captureCheckIn({
    monitorSlug: slug,
    status,
    checkInId: checkInId ?? '',
  });
}

/** Re-export Sentry for direct access where needed. */
export { Sentry };
