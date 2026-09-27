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
  recordProcessingDuration,
  emitTickGauges,
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

// ── Orchestrator ────────────────────────────────────────

/**
 * Main processing pipeline orchestrator.
 *
 * Runs on the main thread. Responsibilities:
 * 1. Batch-claim parcels from MongoDB
 * 2. Dispatch to worker pool for rule evaluation
 * 3. Buffer results in memory
 * 4. Flush outcomes to MongoDB (count OR time trigger)
 * 5. Handle retries and permanent failures
 * 6. Run stale claim recovery on a separate interval
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
      // Cron check-in: mark "in progress" at start of tick
      this.lastCheckInId = cronCheckIn(this.cronSlug, 'in_progress') ?? this.lastCheckInId;

      try {
        await this.processCycle();

        // Record heartbeat for /ready staleness check
        recordOrchestratorTick();

        // Cron check-in: mark "ok" after successful tick
        cronCheckIn(this.cronSlug, 'ok', this.lastCheckInId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Claim cycle failed', { error: message });

        // Cron check-in: mark "error" on tick failure
        cronCheckIn(this.cronSlug, 'error', this.lastCheckInId);
      }
      await this.sleep(this.config.claimIntervalMs);
    }
  }

  /**
   * Batch-claim up to batchSize parcels by calling claimNext concurrently.
   * Each claimNext is an atomic findOneAndUpdate — concurrent calls are safe.
   */
  private async batchClaim(): Promise<ParcelDocument[]> {
    const promises = Array.from({ length: this.config.batchSize }, () =>
      this.parcelRepo.claimNext('pipeline-worker'),
    );
    const results = await Promise.allSettled(promises);

    const claimed: ParcelDocument[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        claimed.push(result.value);
      }
    }
    return claimed;
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
   * 3. Update parcel statuses for successful writes
   * 4. Retry UNROUTED, errored, and write-failed parcels
   */
  private async handleFlush(items: PipelineResult[]): Promise<void> {
    const toWrite: Array<{
      outcome: OutcomeDocument;
      parcel: ParcelDocument;
    }> = [];
    const toRetry: Array<{ parcel: ParcelDocument; reason: string }> = [];

    for (const item of items) {
      if (item.output.error !== null) {
        // Engine threw or worker crashed — retry
        toRetry.push({ parcel: item.parcel, reason: item.output.error });
      } else if (item.output.result?.status === 'UNROUTED') {
        // No rule matched — retry (rules might be updated between attempts)
        toRetry.push({
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

      // Update parcel statuses for successfully written outcomes
      for (const outcomeId of writeResult.succeeded) {
        const tw = toWrite.find((t) => t.outcome._id === outcomeId);
        if (tw) {
          await this.parcelRepo.updateStatus(
            tw.parcel._id,
            tw.outcome.status,
          );

          // Emit metric for each successfully processed parcel
          countParcelProcessed(
            tw.outcome.status,
            tw.outcome.department,
          );
        }
      }

      // Handle write failures — retry those parcels
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

    // Process retries
    for (const retry of toRetry) {
      await this.handleRetry(retry.parcel, retry.reason);
    }
  }

  // ── Private: retry logic ──────────────────────────────

  /**
   * Retry a failed/unrouted parcel:
   * - retryCount < maxRetries → re-queue as RECEIVED (try again)
   * - retryCount >= maxRetries → mark as FAILED permanently + write FAILED outcome
   */
  private async handleRetry(
    parcel: ParcelDocument,
    reason: string,
  ): Promise<void> {
    const newRetryCount = parcel.retryCount + 1;

    if (newRetryCount < this.config.maxRetries) {
      await this.parcelRepo.requeue(parcel._id);

      this.logger.warn('Retrying parcel', {
        parcelId: parcel._id,
        correlationId: parcel.correlationId,
        retryCount: newRetryCount,
        reason,
      });
    } else {
      // Max retries exceeded — permanently fail
      await this.parcelRepo.markFailed(parcel._id);

      // Write a FAILED outcome for audit trail
      const failedOutcome = this.buildFailedOutcome(parcel, reason);
      await this.outcomeRepo.bulkWriteOutcomes([failedOutcome]);

      // Emit metric for FAILED parcel
      countParcelProcessed('FAILED', null);

      // Capture in Sentry — every FAILED transition is an error event
      captureParcelError(
        new Error(`Parcel permanently failed: ${reason}`),
        {
          correlationId: parcel.correlationId,
          parcelId: parcel._id,
          batchId: parcel.batchId,
        },
      );

      this.logger.error('Parcel permanently failed after max retries', {
        parcelId: parcel._id,
        correlationId: parcel.correlationId,
        retryCount: newRetryCount,
        maxRetries: this.config.maxRetries,
        reason,
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
   * Stale claim recovery — runs on its own separate interval,
   * independent of the main processing loop.
   */
  private async sweepStaleClaims(): Promise<void> {
    try {
      const recovered = await this.parcelRepo.recoverStaleClaims(
        this.config.staleAfterMs,
      );
      if (recovered > 0) {
        this.logger.info('Recovered stale claims', { count: recovered });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Stale claim recovery failed', { error: message });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
