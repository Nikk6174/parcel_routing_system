import { ObjectId } from 'mongodb';
import {
  PARCEL_STATUS,
  type ParcelDocument,
  type ParcelStatus,
  type OutcomeDocument,
  type Rule,
  type RuleEngineStatus,
} from '@parcel-routing/shared';
import type { ParcelRepository } from '../db/parcel-repository.js';
import type { OutcomeRepository } from '../db/outcome-repository.js';
import type { RuleRepository } from '../db/rule-repository.js';
import { ResultBuffer } from './result-buffer.js';
import type {
  PipelineConfig,
  PipelineResult,
  WorkerPool,
  Logger,
} from './types.js';
import {
  countParcelProcessed,
  captureParcelError,
  cronCheckIn,
} from '../observability/index.js';
import { recordOrchestratorTick } from '../app.js';

// ── Status mapping ──────────────────────────────────────

/**
 * Map RuleEngineStatus → ParcelStatus.
 * These are defined as separate string unions in the type system but share
 * the same literal values. The explicit mapping avoids an unsafe cast.
 */
function engineStatusToParcelStatus(
  engineStatus: RuleEngineStatus,
): ParcelStatus {
  const map: Record<RuleEngineStatus, ParcelStatus> = {
    ROUTED: PARCEL_STATUS.ROUTED,
    PENDING_APPROVAL: PARCEL_STATUS.PENDING_APPROVAL,
    UNROUTED: PARCEL_STATUS.UNROUTED,
  };
  return map[engineStatus];
}

// ── In-flight claim entry ───────────────────────────────

interface InFlightEntry {
  parcel: ParcelDocument;
  claimedAt: number; // Date.now() timestamp
}

// ── Orchestrator ────────────────────────────────────────

/**
 * Main processing pipeline orchestrator.
 *
 * Runs on the main thread. Responsibilities:
 * 1. Fetch RECEIVED parcels from MongoDB in bulk (single query)
 * 2. Track claims in-memory (no per-parcel DB write for claiming)
 * 3. Dispatch to worker pool for rule evaluation
 * 4. Buffer results in memory
 * 5. Flush outcomes to MongoDB via bulkWrite (batch DB writes)
 * 6. Handle retries and permanent failures
 * 7. Run in-memory stale claim recovery on a separate interval
 *
 * DB WRITE REDUCTION:
 * Previously, claiming N parcels required N individual findOneAndUpdate calls.
 * Now the entire cycle uses:
 *   - 1 find() to fetch RECEIVED parcels
 *   - 1 bulkWrite to mark them as CLAIMED in DB
 *   - 1 bulkWrite to write outcomes
 *   - 1 bulkWrite to update final parcel statuses
 * This reduces Atlas pressure from ~500 writes/cycle to ~4 writes/cycle.
 */
export class PipelineOrchestrator {
  private running = false;
  private claimLoopPromise: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private cachedRules: Rule[] = [];
  private rulesCachedAt = 0;
  private readonly buffer: ResultBuffer;
  private cronSlug: string;
  private lastCheckInId: string | undefined;
  private lastCronCheckInTime = 0;

  /**
   * In-memory claim tracker. Maps parcelId → InFlightEntry.
   * Parcels are added when fetched from DB, removed when their outcome
   * is flushed. The stale sweep checks this map for stuck entries.
   */
  private readonly inFlight = new Map<string, InFlightEntry>();

  constructor(
    private readonly parcelRepo: ParcelRepository,
    private readonly outcomeRepo: OutcomeRepository,
    private readonly ruleRepo: RuleRepository,
    private readonly pool: WorkerPool,
    private readonly config: PipelineConfig,
    private readonly logger: Logger,
    cronSlug = 'orchestrator-heartbeat',
  ) {
    this.cronSlug = cronSlug;
    this.buffer = new ResultBuffer(
      config.bufferMaxSize,
      config.bufferFlushIntervalMs,
    );
    this.buffer.onFlush(async (items) => {
      try {
        await this.handleFlush(items);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Flush handler failed', {
          error: message,
          itemCount: items.length,
        });
      }
    });
  }

  /**
   * Start the pipeline: begin the claim loop and the stale sweep timer.
   */
  async start(): Promise<void> {
    this.running = true;
    this.logger.info('Pipeline starting', {
      batchSize: this.config.batchSize,
      bufferMaxSize: this.config.bufferMaxSize,
      bufferFlushIntervalMs: this.config.bufferFlushIntervalMs,
      maxRetries: this.config.maxRetries,
    });

    // On startup, recover any CLAIMED parcels left by a previous server
    // instance (crash, hot-reload, restart). Since we use in-memory claiming,
    // any CLAIMED parcel in the DB with no corresponding inFlight entry
    // is orphaned. Reset ALL of them back to RECEIVED with staleAfterMs=0.
    const recovered = await this.parcelRepo.recoverStaleClaims(0);
    if (recovered > 0) {
      this.logger.info('Recovered orphaned CLAIMED parcels from previous instance', {
        count: recovered,
      });
    }

    // Stale claim recovery runs on its own separate interval,
    // independent of the main processing loop.
    this.sweepTimer = setInterval(() => {
      void this.sweepStaleClaims();
    }, this.config.staleSweepIntervalMs);

    this.claimLoopPromise = this.runClaimLoop();
  }

  /**
   * Gracefully stop the pipeline:
   * - Stop claiming new parcels
   * - Wait for in-flight cycle to finish
   * - Flush remaining buffered results
   * - Shut down worker pool
   */
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('Pipeline stopping');

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    if (this.claimLoopPromise) {
      await this.claimLoopPromise;
    }

    await this.buffer.flush();
    this.buffer.dispose();

    // Re-queue any in-flight parcels back to RECEIVED so they aren't lost
    if (this.inFlight.size > 0) {
      const staleIds = Array.from(this.inFlight.keys());
      await this.parcelRepo.bulkRequeue(staleIds);
      this.logger.info('Re-queued in-flight parcels on shutdown', {
        count: staleIds.length,
      });
      this.inFlight.clear();
    }

    await this.pool.destroy();
    this.logger.info('Pipeline stopped');
  }

  /**
   * Run a single claim-process cycle.
   * Public for testing — in production, called by the internal claim loop.
   */
  async processCycle(): Promise<void> {
    await this.refreshRulesIfNeeded();

    if (this.cachedRules.length === 0) {
      this.logger.warn('No active rules found — skipping cycle');
      return;
    }

    const claimed = await this.batchClaim();
    if (claimed.length === 0) return;

    this.logger.info('Claimed parcels for processing', {
      count: claimed.length,
      inFlightTotal: this.inFlight.size,
    });

    // Dispatch all claimed parcels to the worker pool concurrently.
    // Promise.allSettled ensures one worker failure doesn't crash the batch.
    const settlements = await Promise.allSettled(
      claimed.map((parcel) =>
        this.pool.run({ parcel, rules: this.cachedRules }),
      ),
    );

    for (let i = 0; i < settlements.length; i++) {
      const parcel = claimed[i];
      const settlement = settlements[i];
      if (!parcel || !settlement) continue;

      if (settlement.status === 'fulfilled') {
        this.buffer.add({ parcel, output: settlement.value });
      } else {
        // Worker thread crashed or threw an unhandled error.
        // Convert to a WorkerOutput with error so the flush handler
        // can apply normal retry logic.
        const message =
          settlement.reason instanceof Error
            ? settlement.reason.message
            : String(settlement.reason);

        this.logger.error('Worker failed for parcel', {
          parcelId: parcel._id,
          correlationId: parcel.correlationId,
          error: message,
        });

        this.buffer.add({
          parcel,
          output: {
            parcelId: parcel._id,
            correlationId: parcel.correlationId,
            result: null,
            error: `Worker failure: ${message}`,
          },
        });
      }
    }
  }

  /**
   * Manually flush the result buffer. Used in testing and graceful shutdown.
   */
  async flushBuffer(): Promise<void> {
    await this.buffer.flush();
  }

  // ── Private: claim loop ───────────────────────────────

  private async runClaimLoop(): Promise<void> {
    while (this.running) {
      const now = Date.now();
      const shouldCronCheckIn = now - this.lastCronCheckInTime >= 60_000;

      if (shouldCronCheckIn) {
        this.lastCronCheckInTime = now;
        this.lastCheckInId = cronCheckIn(this.cronSlug, 'in_progress') ?? this.lastCheckInId;
      }

      try {
        await this.processCycle();

        // Record heartbeat for /ready staleness check (every tick)
        recordOrchestratorTick();

        // Cron check-in: mark "ok" after successful tick if this tick was checked in
        if (shouldCronCheckIn && this.lastCheckInId) {
          cronCheckIn(this.cronSlug, 'ok', this.lastCheckInId);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Claim cycle failed', { error: message });

        // Cron check-in: mark "error" on tick failure
        if (this.lastCheckInId) {
          cronCheckIn(this.cronSlug, 'error', this.lastCheckInId);
        }
      }
      await this.sleep(this.config.claimIntervalMs);
    }
  }

  /**
   * In-memory batch claim strategy:
   * 1. Fetch up to batchSize RECEIVED parcels in a single find() query
   * 2. Mark them CLAIMED in DB via a single bulkWrite (not N individual calls)
   * 3. Track them in the in-memory inFlight map
   *
   * If the bulkWrite for CLAIMED fails, the parcels stay RECEIVED in DB
   * and will be picked up on the next cycle — no data loss.
   */
  private async batchClaim(): Promise<ParcelDocument[]> {
    // Only fetch as many as we have room for (avoid unbounded in-flight growth)
    const capacity = Math.max(0, this.config.batchSize - this.inFlight.size);
    if (capacity === 0) return [];

    const parcels = await this.parcelRepo.fetchReceived(capacity);
    if (parcels.length === 0) return [];

    // Filter out any parcels that are already in-flight (race condition guard)
    const fresh = parcels.filter((p) => !this.inFlight.has(p._id));
    if (fresh.length === 0) return [];

    // Mark as CLAIMED in DB in one bulkWrite — single DB round-trip
    try {
      await this.parcelRepo.bulkUpdateStatus(
        fresh.map((p) => ({ parcelId: p._id, status: PARCEL_STATUS.CLAIMED as ParcelStatus })),
      );
    } catch (err: unknown) {
      // If bulk claim fails, skip this cycle — parcels stay RECEIVED, no harm
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Bulk claim write failed — skipping cycle', { error: message });
      return [];
    }

    // Track in memory
    const now = Date.now();
    for (const p of fresh) {
      this.inFlight.set(p._id, { parcel: p, claimedAt: now });
    }

    return fresh;
  }

  // ── Private: rule cache ───────────────────────────────

  /**
   * Force the rule cache to reload on the next processing cycle.
   *
   * Called by the rule-write handler (POST/PUT /rules) so that newly
   * created or updated rules take effect IMMEDIATELY — no waiting for
   * the TTL to expire.
   *
   * The TTL-based refresh in refreshRulesIfNeeded() is KEPT as a safety
   * net for rule changes that bypass this process's API (e.g., direct
   * MongoDB edits, a future second instance writing rules).
   */
  invalidateRuleCache(): void {
    this.rulesCachedAt = 0;
    this.logger.info('Rule cache invalidated — will refresh on next cycle');
  }

  private async refreshRulesIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.rulesCachedAt < this.config.ruleCacheTtlMs) return;

    this.cachedRules = await this.ruleRepo.findActive();
    this.rulesCachedAt = now;
    this.logger.info('Refreshed rule cache', {
      ruleCount: this.cachedRules.length,
    });
  }

  // ── Private: flush handler ────────────────────────────

  /**
   * Process a batch of flushed results:
   * 1. Build OutcomeDocuments for successful evaluations
   * 2. Write outcomes via bulkWrite (ordered:false)
   * 3. Update parcel statuses in a single bulkWrite
   * 4. Remove from inFlight map
   * 5. Retry UNROUTED, errored, and write-failed parcels
   */
  private async handleFlush(items: PipelineResult[]): Promise<void> {
    const toWrite: Array<{
      outcome: OutcomeDocument;
      parcel: ParcelDocument;
    }> = [];
    const toRetry: Array<{ parcel: ParcelDocument; reason: string }> = [];
    const toFail: Array<{ parcel: ParcelDocument; reason: string; retryCount?: number }> = [];

    for (const item of items) {
      if (item.output.error !== null) {
        // Engine threw or worker crashed — retry (transient error)
        toRetry.push({ parcel: item.parcel, reason: item.output.error });
      } else if (item.output.result?.status === 'UNROUTED') {
        // No rule matched — fail immediately (retrying won't help,
        // no human is adding a rule in the next second)
        toFail.push({
          parcel: item.parcel,
          reason: item.output.result.reason,
        });
      } else if (item.output.result) {
        // Successful evaluation (ROUTED or PENDING_APPROVAL) — write outcome
        toWrite.push({
          outcome: this.buildOutcome(item),
          parcel: item.parcel,
        });
      }
    }

    // Bulk-write outcomes for successful evaluations
    if (toWrite.length > 0) {
      const outcomes = toWrite.map((tw) => tw.outcome);
      const writeResult =
        await this.outcomeRepo.bulkWriteOutcomes(outcomes);

      // Collect status updates for successfully written outcomes
      const statusUpdates: Array<{ parcelId: string; status: ParcelStatus }> = [];
      for (const outcomeId of writeResult.succeeded) {
        const tw = toWrite.find((t) => t.outcome._id === outcomeId);
        if (tw) {
          statusUpdates.push({
            parcelId: tw.parcel._id,
            status: tw.outcome.status,
          });

          // Emit metric for each successfully processed parcel
          countParcelProcessed(
            tw.outcome.status,
            tw.outcome.department,
          );

          // Remove from in-flight tracker
          this.inFlight.delete(tw.parcel._id);
        }
      }

      // Single bulkWrite for all status updates instead of N individual updateOne calls
      if (statusUpdates.length > 0) {
        await this.parcelRepo.bulkUpdateStatus(statusUpdates);
      }

      // Handle write failures — retry those parcels (transient DB error)
      for (const failure of writeResult.failed) {
        const tw = toWrite.find((t) => t.outcome._id === failure.id);
        if (tw) {
          toRetry.push({
            parcel: tw.parcel,
            reason: `Outcome write failed: ${failure.error}`,
          });
        }
      }

      this.logger.info('Flushed outcomes', {
        succeeded: writeResult.succeeded.length,
        failed: writeResult.failed.length,
      });
    }

    // Process retries (only actual errors — worker crashes, DB write failures)
    const requeueIds: string[] = [];

    for (const retry of toRetry) {
      const newRetryCount = retry.parcel.retryCount + 1;
      if (newRetryCount < this.config.maxRetries) {
        requeueIds.push(retry.parcel._id);
        this.logger.warn('Retrying parcel', {
          parcelId: retry.parcel._id,
          correlationId: retry.parcel.correlationId,
          retryCount: newRetryCount,
          reason: retry.reason,
        });
      } else {
        // Exceeded max retries — move to permanent failure
        toFail.push({ ...retry, retryCount: newRetryCount });
      }
      // Remove from in-flight either way
      this.inFlight.delete(retry.parcel._id);
    }

    // Bulk re-queue retriable parcels
    if (requeueIds.length > 0) {
      await this.parcelRepo.bulkRequeue(requeueIds);
    }

    // ── Batched permanent failures ──────────────────────
    if (toFail.length > 0) {
      // Build all failed outcomes at once
      const failedOutcomes = toFail.map((f) =>
        this.buildFailedOutcome(f.parcel, f.reason),
      );

      // 1 bulkWrite for all failed outcomes (audit trail)
      await this.outcomeRepo.bulkWriteOutcomes(failedOutcomes);

      // 1 bulkWrite to mark all parcels as FAILED
      await this.parcelRepo.bulkUpdateStatus(
        toFail.map((f) => ({
          parcelId: f.parcel._id,
          status: PARCEL_STATUS.FAILED as ParcelStatus,
          retryCount: f.retryCount,
        })),
      );

      // Emit metrics and Sentry for each
      for (const fail of toFail) {
        countParcelProcessed('FAILED', null);
        this.inFlight.delete(fail.parcel._id);

        this.logger.error('Parcel permanently failed after max retries', {
          parcelId: fail.parcel._id,
          correlationId: fail.parcel.correlationId,
          reason: fail.reason,
        });

        captureParcelError(
          new Error(`Parcel permanently failed: ${fail.reason}`),
          {
            correlationId: fail.parcel.correlationId,
            parcelId: fail.parcel._id,
            batchId: fail.parcel.batchId,
          },
        );
      }

      this.logger.error('Parcels permanently failed', {
        count: toFail.length,
      });
    }
  }

  // ── Private: outcome builders ─────────────────────────

  private buildOutcome(item: PipelineResult): OutcomeDocument {
    const result = item.output.result;
    if (!result) {
      throw new Error(
        `Cannot build outcome: no result for parcel ${item.parcel._id}`,
      );
    }

    return {
      _id: new ObjectId().toHexString(),
      parcelId: item.parcel._id,
      correlationId: item.parcel.correlationId,
      department: result.department,
      matchedRuleId: result.matchedRuleId,
      matchedRuleVersion: result.matchedRuleVersion,
      status: engineStatusToParcelStatus(result.status),
      reason: result.reason,
      parcelSnapshot: {
        weight: item.parcel.weight,
        value: item.parcel.value,
        destinationCountry: item.parcel.destinationCountry,
        recipient: item.parcel.recipient,
        custom: item.parcel.custom,
      },
      processedAt: new Date(),
    };
  }

  private buildFailedOutcome(
    parcel: ParcelDocument,
    reason: string,
  ): OutcomeDocument {
    return {
      _id: new ObjectId().toHexString(),
      parcelId: parcel._id,
      correlationId: parcel.correlationId,
      department: null,
      matchedRuleId: null,
      matchedRuleVersion: null,
      status: PARCEL_STATUS.FAILED,
      reason,
      parcelSnapshot: {
        weight: parcel.weight,
        value: parcel.value,
        destinationCountry: parcel.destinationCountry,
        recipient: parcel.recipient,
        custom: parcel.custom,
      },
      processedAt: new Date(),
    };
  }

  // ── Private: stale sweep ──────────────────────────────

  /**
   * In-memory stale claim recovery.
   *
   * Checks the inFlight map for parcels claimed longer than staleAfterMs.
   * Re-queues them in DB via a single bulkRequeue call.
   *
   * This replaces the old DB-level recoverStaleClaims — since we now track
   * claims in memory, the sweep source is the in-memory map, not a DB query.
   */
  private async sweepStaleClaims(): Promise<void> {
    try {
      const now = Date.now();
      const staleIds: string[] = [];

      for (const [id, entry] of this.inFlight) {
        if (now - entry.claimedAt > this.config.staleAfterMs) {
          staleIds.push(id);
        }
      }

      if (staleIds.length === 0) return;

      // Re-queue in DB in one call
      const recovered = await this.parcelRepo.bulkRequeue(staleIds);

      // Remove from in-flight
      for (const id of staleIds) {
        this.inFlight.delete(id);
      }

      this.logger.info('Recovered stale in-flight claims', {
        count: recovered,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Stale claim recovery failed', { error: message });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
