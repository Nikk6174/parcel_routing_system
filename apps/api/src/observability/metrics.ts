/**
 * Sentry metrics for parcel processing observability.
 *
 * Uses the Sentry metrics API (SDK >= 10.25) to emit:
 * - parcels_processed (counter): by status + department
 * - parcel_processing_duration (distribution): in ms
 * - pending_parcels, failed_parcels, oldest_received_age_seconds (gauges)
 */
import * as Sentry from '@sentry/node';
import { isSentryEnabled } from './sentry.js';

/**
 * Increment the parcels_processed counter.
 *
 * @param status  ROUTED | PENDING_APPROVAL | UNROUTED | FAILED
 * @param department  The target department, or 'UNROUTED' for no match.
 */
export function countParcelProcessed(
  status: string,
  department: string | null,
): void {
  if (!isSentryEnabled()) return;
  Sentry.metrics.increment('parcels_processed', 1, {
    tags: { status, department: department ?? 'UNROUTED' },
  });
}

/**
 * Record the time taken to process a single parcel (ms).
 */
export function recordProcessingDuration(durationMs: number): void {
  if (!isSentryEnabled()) return;
  Sentry.metrics.distribution('parcel_processing_duration', durationMs, {
    unit: 'millisecond',
  });
}

/**
 * Emit orchestrator tick gauges.
 *
 * @param pending  Count of RECEIVED + CLAIMED parcels.
 * @param failed   Count of FAILED parcels.
 * @param oldestAgeSeconds  Age of the oldest RECEIVED parcel in seconds.
 */
export function emitTickGauges(
  pending: number,
  failed: number,
  oldestAgeSeconds: number,
): void {
  if (!isSentryEnabled()) return;
  Sentry.metrics.gauge('pending_parcels', pending);
  Sentry.metrics.gauge('failed_parcels', failed);
  Sentry.metrics.gauge('oldest_received_age_seconds', oldestAgeSeconds);
}
