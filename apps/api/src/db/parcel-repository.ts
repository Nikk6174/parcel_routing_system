import { type Collection, type Db, ObjectId } from 'mongodb';
import {
  PARCEL_STATUS,
  type ParcelDocument,
  type ParcelStatus,
} from '@parcel-routing/shared';

/**
 * Repository for the `parcels` collection.
 *
 * This collection serves as the async handoff layer (replacing a message queue).
 * Workers claim parcels atomically via findOneAndUpdate — MongoDB's document-level
 * locking guarantees exactly-once delivery without needing a distributed lock
 * or external broker.
 */
export class ParcelRepository {
  private readonly collection: Collection<ParcelDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ParcelDocument>('parcels');
  }

  /**
   * Insert a new parcel into the collection.
   * Generates an `_id` if not already present.
   */
  async insertOne(
    parcel: Omit<ParcelDocument, '_id'>,
  ): Promise<ParcelDocument> {
    const doc: ParcelDocument = {
      _id: new ObjectId().toHexString(),
      ...parcel,
    };
    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Insert multiple parcels in a single batch operation.
   * Added in Phase 5 — batch ingestion needs efficient bulk writes.
   */
  async insertMany(
    parcels: Array<Omit<ParcelDocument, '_id'>>,
  ): Promise<ParcelDocument[]> {
    if (parcels.length === 0) return [];
    const docs: ParcelDocument[] = parcels.map((p) => ({
      _id: new ObjectId().toHexString(),
      ...p,
    }));
    await this.collection.insertMany(docs);
    return docs;
  }

  /**
   * Aggregate parcel counts by status for a given batchId.
   * Added in Phase 5 — cheap aggregation for the batch status endpoint.
   */
  async countByStatusForBatch(
    batchId: string,
  ): Promise<Record<string, number>> {
    const pipeline = [
      { $match: { batchId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];
    const results = await this.collection.aggregate(pipeline).toArray();
    const counts: Record<string, number> = {};
    for (const row of results) {
      const key = row['_id'] as string;
      counts[key] = row['count'] as number;
    }
    return counts;
  }

  /**
   * Server-side paginated parcel list with optional filters.
   * Added in Phase 6 — the frontend results table needs pagination.
   */
  async findPaginated(opts: {
    page: number;
    limit: number;
    status?: string;
    batchId?: string;
  }): Promise<{ parcels: ParcelDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (opts.status) filter['status'] = opts.status;
    if (opts.batchId) filter['batchId'] = opts.batchId;

    const [parcels, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { parcels, total };
  }

  /**
   * Atomically claim the next available parcel for processing.
   *
   * Uses findOneAndUpdate which is atomic at the MongoDB server level.
   *
   * HOW THIS GUARANTEES EXACTLY-ONCE DELIVERY:
   * MongoDB's findOneAndUpdate acquires a write lock on the matched document
   * before applying the update. If N workers call claimNext() concurrently
   * against the same document:
   *
   *   1. Worker A's findOneAndUpdate matches the document (status: RECEIVED)
   *      → MongoDB locks the document → updates status to CLAIMED → returns it.
   *   2. Workers B..N's findOneAndUpdate queries execute AFTER the lock is released.
   *      By then, the document's status is CLAIMED, so it no longer matches
   *      the filter { status: RECEIVED }. They receive null.
   *
   * This is why we don't need a distributed lock or message queue — MongoDB's
   * atomic findOneAndUpdate provides exactly-once-delivery semantics for free.
   *
   * @param workerId Unique identifier of the claiming worker.
   * @returns The claimed parcel, or null if no parcel is available.
   */
  async claimNext(workerId: string): Promise<ParcelDocument | null> {
    const result = await this.collection.findOneAndUpdate(
      { status: PARCEL_STATUS.RECEIVED },
      {
        $set: {
          status: PARCEL_STATUS.CLAIMED as ParcelStatus,
          claimedBy: workerId,
          claimedAt: new Date(),
        },
      },
      {
        sort: { createdAt: 1 },
        returnDocument: 'after',
      },
    );

    return result ?? null;
  }

  /**
   * Recovery sweep for stale claims (TIMED_OUT recovery).
   *
   * A parcel is "stale" if it has been in CLAIMED status for longer than
   * `staleAfterMs` milliseconds — meaning the worker that claimed it likely
   * crashed, hung, or was killed without producing an outcome.
   *
   * This method resets such parcels back to RECEIVED so another worker can
   * pick them up. It also increments `retryCount` for monitoring.
   *
   * This replaces the "dead letter queue" / "visibility timeout" mechanism
   * that a traditional message queue would provide. It should be called on
   * a periodic schedule (e.g. every 60 seconds).
   *
   * @param staleAfterMs How many milliseconds a claim can be held before
   *                     it's considered stale. E.g. 300_000 for 5 minutes.
   * @returns The number of parcels that were reset.
   */
  async recoverStaleClaims(staleAfterMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMs);

    const result = await this.collection.updateMany(
      {
        status: PARCEL_STATUS.CLAIMED,
        claimedAt: { $lt: cutoff },
      },
      {
        $set: {
          status: PARCEL_STATUS.RECEIVED as ParcelStatus,
          claimedBy: null,
          claimedAt: null,
        },
        $inc: { retryCount: 1 },
      },
    );

    return result.modifiedCount;
  }

  /**
   * Update a parcel's status.
   * @returns true if the parcel was found and updated.
   */
  async updateStatus(
    parcelId: string,
    status: ParcelStatus,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: parcelId },
      { $set: { status } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Find a parcel by _id.
   */
  async findById(id: string): Promise<ParcelDocument | null> {
    return this.collection.findOne({ _id: id });
  }

  /**
   * Re-queue a parcel for retry: reset to RECEIVED, clear claim state,
   * increment retryCount.
   *
   * Added in Phase 4 — the processing pipeline needs atomic retry
   * operations after engine errors or UNROUTED results.
   */
  async requeue(parcelId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: parcelId },
      {
        $set: {
          status: PARCEL_STATUS.RECEIVED as ParcelStatus,
          claimedBy: null,
          claimedAt: null,
        },
        $inc: { retryCount: 1 },
      },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Mark a parcel as permanently failed: set status to FAILED,
   * increment retryCount.
   *
   * Added in Phase 4 — called when a parcel exceeds maxRetries.
   */
  async markFailed(parcelId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: parcelId },
      {
        $set: { status: PARCEL_STATUS.FAILED as ParcelStatus },
        $inc: { retryCount: 1 },
      },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Fetch up to `limit` parcels with status RECEIVED in a single query.
   * Used by the in-memory claiming strategy — no status update in DB,
   * just a bulk read. The orchestrator tracks claims in memory.
   */
  async fetchReceived(limit: number): Promise<ParcelDocument[]> {
    return this.collection
      .find({ status: PARCEL_STATUS.RECEIVED })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Bulk-update parcel statuses in a single bulkWrite call.
   * Replaces N individual updateOne calls with one batched operation.
   */
  async bulkUpdateStatus(
    updates: Array<{ parcelId: string; status: ParcelStatus }>,
  ): Promise<number> {
    if (updates.length === 0) return 0;

    const ops = updates.map((u) => ({
      updateOne: {
        filter: { _id: u.parcelId },
        update: { $set: { status: u.status } },
      },
    }));

    const result = await this.collection.bulkWrite(ops, { ordered: false });
    return result.modifiedCount;
  }

  /**
   * Bulk re-queue parcels back to RECEIVED (for stale recovery or retries).
   * Single bulkWrite call instead of N individual updateOne calls.
   */
  async bulkRequeue(parcelIds: string[]): Promise<number> {
    if (parcelIds.length === 0) return 0;

    const ops = parcelIds.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            status: PARCEL_STATUS.RECEIVED as ParcelStatus,
            claimedBy: null,
            claimedAt: null,
          },
          $inc: { retryCount: 1 },
        },
      },
    }));

    const result = await this.collection.bulkWrite(ops, { ordered: false });
    return result.modifiedCount;
  }
}
