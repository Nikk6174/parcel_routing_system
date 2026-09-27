import { type Collection, type Db, MongoBulkWriteError } from 'mongodb';
import type { OutcomeDocument } from '@parcel-routing/shared';

/** Result of a bulk outcome write — reports which succeeded and which failed. */
export interface BulkWriteOutcomeResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Repository for the `outcomes` collection.
 *
 * One outcome per processed parcel — records the routing decision and a
 * snapshot of the parcel for auditability.
 */
export class OutcomeRepository {
  private readonly collection: Collection<OutcomeDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OutcomeDocument>('outcomes');
  }

  /**
   * Write multiple outcomes in a single batch operation.
   *
   * Uses bulkWrite with `ordered: false` — every outcome is independent.
   * One failure must never block or hide the others. MongoDB will attempt
   * ALL operations regardless of individual failures, then report which
   * specific ones failed and why.
   *
   * @returns An object listing which outcome IDs succeeded and which failed.
   */
  async bulkWriteOutcomes(
    outcomes: OutcomeDocument[],
  ): Promise<BulkWriteOutcomeResult> {
    if (outcomes.length === 0) {
      return { succeeded: [], failed: [] };
    }

    const ops = outcomes.map((outcome) => ({
      insertOne: { document: outcome },
    }));

    try {
      await this.collection.bulkWrite(ops, { ordered: false });

      // If no error, all operations succeeded
      return {
        succeeded: outcomes.map((o) => o._id),
        failed: [],
      };
    } catch (err: unknown) {
      if (err instanceof MongoBulkWriteError) {
        /*
         * MongoBulkWriteError is thrown when ANY operation in the batch fails.
         * Because ordered=false, MongoDB still attempted ALL operations.
         * err.writeErrors tells us exactly which indices failed.
         *
         * We map each index back to the original outcome to build a precise
         * success/failure report.
         */
        const failedIndexes = new Map<number, string>();
        const writeErrors = Array.isArray(err.writeErrors)
          ? err.writeErrors
          : [err.writeErrors];
        for (const writeErr of writeErrors) {
          failedIndexes.set(
            writeErr.index,
            writeErr.errmsg ?? `Write error code ${String(writeErr.code)}`,
          );
        }

        const succeeded: string[] = [];
        const failed: Array<{ id: string; error: string }> = [];

        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i];
          if (!outcome) continue;

          const errorMsg = failedIndexes.get(i);
          if (errorMsg !== undefined) {
            failed.push({ id: outcome._id, error: errorMsg });
          } else {
            succeeded.push(outcome._id);
          }
        }

        return { succeeded, failed };
      }

      // Non-bulk error (e.g. network failure) — log context and re-throw
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Unexpected error during bulk outcome write: ${message}`,
      );
    }
  }

  /**
   * Find an outcome by parcel ID.
   */
  async findByParcelId(parcelId: string): Promise<OutcomeDocument | null> {
    return this.collection.findOne({ parcelId });
  }
}
