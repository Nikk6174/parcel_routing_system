import type {
  ParcelDocument,
  RuleEngineResult,
} from '@parcel-routing/shared';
import type { Rule } from '@parcel-routing/shared';

// ── Worker I/O ──────────────────────────────────────────

/** Data sent to a piscina worker thread for rule evaluation. */
export interface WorkerInput {
  parcel: ParcelDocument;
  rules: Rule[];
}

/** Data returned from a piscina worker thread after evaluation. */
export interface WorkerOutput {
  parcelId: string;
  correlationId: string;
  /** The engine result, or null if the engine threw. */
  result: RuleEngineResult | null;
  /** Error message, or null if evaluation succeeded. */
  error: string | null;
}

// ── Pipeline Result ─────────────────────────────────────

/** A completed evaluation paired with its source parcel. */
export interface PipelineResult {
  parcel: ParcelDocument;
  output: WorkerOutput;
}

// ── Worker Pool ─────────────────────────────────────────

/**
 * Abstraction over the worker thread pool (piscina in production).
 * Using an interface enables DI for testing without real worker threads.
 */
export interface WorkerPool {
  run(data: WorkerInput): Promise<WorkerOutput>;
  destroy(): Promise<void>;
}

// ── Logger ──────────────────────────────────────────────

/**
 * Minimal structured logger interface.
 * In production, this is backed by Fastify's pino logger.
 * In tests, it can be a no-op or spy.
 */
export interface Logger {
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

// ── Pipeline Config ─────────────────────────────────────

export interface PipelineConfig {
  /** Number of parcels to claim per cycle. */
  batchSize: number;
  /** Flush buffer when it reaches this many items. */
  bufferMaxSize: number;
  /** Flush buffer after this many ms, regardless of size. */
  bufferFlushIntervalMs: number;
  /** How often to run the main claim-process cycle (ms). */
  claimIntervalMs: number;
  /** How often to run stale claim recovery (ms). */
  staleSweepIntervalMs: number;
  /** How long a claim can be held before it's stale (ms). */
  staleAfterMs: number;
  /** Max retries before marking parcel as FAILED. */
  maxRetries: number;
  /** How often to refresh cached rules from DB (ms). */
  ruleCacheTtlMs: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  batchSize: 50,
  bufferMaxSize: 50,
  bufferFlushIntervalMs: 5_000,
  claimIntervalMs: 1_000,
  staleSweepIntervalMs: 30_000,
  staleAfterMs: 300_000,
  maxRetries: 3,
  ruleCacheTtlMs: 30_000,
};
