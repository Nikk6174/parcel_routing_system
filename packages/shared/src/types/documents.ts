/**
 * MongoDB document types for the Parcel Routing System.
 *
 * These extend the rule-engine types (Phase 2) with DB-specific fields
 * like timestamps, status tracking, and traceability metadata.
 */
import type { Rule, Parcel } from '../rule-engine/types.js';
import type { ParcelStatus } from './parcel-status.js';

/**
 * A routing rule as stored in MongoDB's `routing_rules` collection.
 * Extends the Phase 2 Rule shape with audit fields.
 */
export interface RuleDocument extends Rule {
  createdAt: Date;
  createdBy: string;
}

/**
 * A parcel as stored in MongoDB's `parcels` collection.
 * Extends the Phase 2 Parcel shape with processing/claim state.
 *
 * This collection serves as the async handoff layer (replacing a message queue).
 * Workers atomically claim parcels via findOneAndUpdate.
 */
export interface ParcelDocument extends Parcel {
  _id: string;
  status: ParcelStatus;
  /** Groups parcels that were ingested together (e.g. from one XML file). */
  batchId: string | null;
  /** Unique trace ID for correlating a parcel through the entire pipeline. */
  correlationId: string;
  /** Number of times this parcel has been re-queued after a stale claim recovery. */
  retryCount: number;
  /** The worker ID that currently owns this parcel (null if unclaimed). */
  claimedBy: string | null;
  /** When the current claim was made (null if unclaimed). */
  claimedAt: Date | null;
  /**
   * The ingestion format this parcel came through.
   * Stored purely for traceability/debugging — does NOT affect routing logic.
   */
  sourceFormat: 'json' | 'xml';
  createdAt: Date;
}

/**
 * An evaluation outcome stored in MongoDB's `outcomes` collection.
 * One outcome per processed parcel — records the routing decision and a
 * snapshot of the parcel at the time of evaluation for auditability.
 */
export interface OutcomeDocument {
  _id: string;
  parcelId: string;
  correlationId: string;
  department: string | null;
  matchedRuleId: string | null;
  matchedRuleVersion: number | null;
  status: ParcelStatus;
  reason: string;
  /** Snapshot of the parcel at processing time — immutable audit trail. */
  parcelSnapshot: Record<string, unknown>;
  processedAt: Date;
}
