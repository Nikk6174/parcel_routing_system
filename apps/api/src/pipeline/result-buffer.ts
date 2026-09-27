import type { PipelineResult } from './types.js';

/**
 * In-memory buffer that accumulates pipeline results and flushes them
 * in batches — either when the buffer reaches maxSize OR after
 * flushIntervalMs, whichever comes first.
 *
 * ⚠️ DURABILITY TRADE-OFF:
 * Results sitting in this buffer are NOT yet durable in MongoDB.
 * If the process crashes between a worker completing and the next flush:
 *
 *   - Max data-loss window = min(bufferMaxSize results, bufferFlushIntervalMs).
 *   - With defaults (maxSize=50, interval=5000ms): up to 50 results or
 *     5 seconds of work can be lost from MongoDB's perspective.
 *
 * RECOVERY: The parcels themselves remain in CLAIMED status in MongoDB.
 * The stale claim recovery sweep (recoverStaleClaims, runs every 30s by
 * default) will reset them to RECEIVED after the staleAfterMs threshold,
 * so they'll be reprocessed by another worker. The trade-off is duplicated
 * computation, NOT permanent data loss.
 */
export class ResultBuffer {
  private buffer: PipelineResult[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private flushHandler:
    | ((items: PipelineResult[]) => Promise<void>)
    | null = null;

  constructor(
    private readonly maxSize: number,
    private readonly flushIntervalMs: number,
  ) {}

  /**
   * Register the callback invoked when the buffer flushes.
   * The callback receives the batch of results that were buffered.
   */
  onFlush(handler: (items: PipelineResult[]) => Promise<void>): void {
    this.flushHandler = handler;
  }

  /**
   * Add a result to the buffer.
   * Triggers a count-based flush if buffer reaches maxSize.
   * Starts the time-based flush timer if not already running.
   */
  add(item: PipelineResult): void {
    this.buffer.push(item);
    this.ensureTimerStarted();

    if (this.buffer.length >= this.maxSize) {
      void this.flush();
    }
  }

  /**
   * Immediately flush all buffered results to the handler.
   * Called on: count trigger, time trigger, and graceful shutdown.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    this.clearTimer();

    const items = [...this.buffer];
    this.buffer = [];

    try {
      if (this.flushHandler) {
        await this.flushHandler(items);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Current number of buffered items. */
  get size(): number {
    return this.buffer.length;
  }

  /** Stop the timer and clear the buffer. Call on shutdown. */
  dispose(): void {
    this.clearTimer();
    this.buffer = [];
  }

  /**
   * Start the time-based flush timer.
   * Uses setTimeout (not setInterval) — fires once, relative to the first
   * un-flushed item. A new timer starts when the next item is added.
   */
  private ensureTimerStarted(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
