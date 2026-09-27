/**
 * Parcel processing status enum.
 *
 * Lifecycle: RECEIVED → CLAIMED → ROUTED/PENDING_APPROVAL/UNROUTED/FAILED
 *            PENDING_APPROVAL → APPROVED/REJECTED
 *            CLAIMED (stale) → RECEIVED (via recovery sweep, retryCount++)
 *            CLAIMED (stale, never recovered) → TIMED_OUT
 */
export const PARCEL_STATUS = {
  /** Parcel ingested and waiting to be claimed by a worker. */
  RECEIVED: 'RECEIVED',
  /** A worker has atomically claimed this parcel for processing. */
  CLAIMED: 'CLAIMED',
  /** Rule engine matched a routing rule; parcel is assigned to a department. */
  ROUTED: 'ROUTED',
  /** A precondition rule requires approval before routing proceeds. */
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /** A human approved the pending parcel. */
  APPROVED: 'APPROVED',
  /** A human rejected the pending parcel. */
  REJECTED: 'REJECTED',
  /** No routing rule matched this parcel. */
  UNROUTED: 'UNROUTED',
  /** Processing failed with an error. */
  FAILED: 'FAILED',
  /** Worker claimed this parcel but never completed processing within the timeout. */
  TIMED_OUT: 'TIMED_OUT',
} as const;

/** Union of all valid parcel status strings. */
export type ParcelStatus = (typeof PARCEL_STATUS)[keyof typeof PARCEL_STATUS];
