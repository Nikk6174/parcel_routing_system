import type { Collection, Db } from 'mongodb';

/**
 * Stored idempotency result.
 */
interface IdempotencyRecord {
  _id: string;
  statusCode: number;
  response: unknown;
  createdAt: Date;
}

/**
 * Repository for idempotency key storage.
 *
 * Uses a MongoDB collection with a TTL index (24h) for auto-cleanup.
 * If a request with the same Idempotency-Key was already processed,
 * we return the stored result instead of creating a duplicate.
 */
export class IdempotencyRepository {
  private readonly collection: Collection<IdempotencyRecord>;

  constructor(db: Db) {
    this.collection = db.collection<IdempotencyRecord>('idempotency_keys');
  }

  /** Ensure TTL index for auto-expiry (idempotent, safe to call on startup). */
  async ensureIndex(): Promise<void> {
    await this.collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 86_400, name: 'idx_idempotency_ttl' },
    );
  }

  /** Find a previous result by idempotency key. */
  async find(key: string): Promise<{ statusCode: number; response: unknown } | null> {
    const record = await this.collection.findOne({ _id: key });
    if (!record) return null;
    return { statusCode: record.statusCode, response: record.response };
  }

  /** Save a result for an idempotency key (upsert to handle race conditions). */
  async save(
    key: string,
    statusCode: number,
    response: unknown,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          _id: key,
          statusCode,
          response,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
