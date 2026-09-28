/**
 * Sentry initialization for the React frontend.
 *
 * Must be called BEFORE ReactDOM.createRoot() so React's error
 * handling is instrumented. If VITE_SENTRY_DSN is not set,
 * Sentry is silently disabled.
 */
import * as Sentry from '@sentry/react';

export function initSentryReact(): void {
  const dsn = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;

  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN not set — frontend error reporting disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment: (import.meta.env['VITE_SENTRY_ENVIRONMENT'] as string) || 'development',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

/** Re-export for ErrorBoundary usage. */
export { Sentry };
