import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { OutcomeRepository } from './outcome-repository.js';
import { PARCEL_STATUS, type OutcomeDocument } from '@parcel-routing/shared';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: OutcomeRepository;

function makeOutcome(
  overrides: Partial<OutcomeDocument> = {},
): OutcomeDocument {
  return {
    _id: new ObjectId().toHexString(),
    parcelId: new ObjectId().toHexString(),
    correlationId: 'corr-001',
    department: 'heavy-dept',
    matchedRuleId: 'rule-1',
    matchedRuleVersion: 1,
    status: PARCEL_STATUS.ROUTED,
    reason: 'weight 12 > 10',
    parcelSnapshot: { weight: 12, value: 100 },
    processedAt: new Date(),
    ...overrides,
  };
}

describe('OutcomeRepository', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_outcomes');
    repo = new OutcomeRepository(db);
  }, 30_000);

  afterEach(async () => {
    await db.collection('outcomes').deleteMany({});
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  // ── Happy path: all succeed ─────────────────────────
  it('writes multiple outcomes and all succeed', async () => {
    const outcomes = [
      makeOutcome({ correlationId: 'c1' }),
      makeOutcome({ correlationId: 'c2' }),
      makeOutcome({ correlationId: 'c3' }),
    ];

    const result = await repo.bulkWriteOutcomes(outcomes);

    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.succeeded).toContain(outcomes[0]?._id);
    expect(result.succeeded).toContain(outcomes[1]?._id);
    expect(result.succeeded).toContain(outcomes[2]?._id);
  });

  // ── Happy path: empty input ─────────────────────────
  it('returns empty arrays for empty input', async () => {
    const result = await repo.bulkWriteOutcomes([]);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  // ── Invalid: duplicate _id → partial failure ────────
  it('reports partial failure when some outcomes have duplicate _ids', async () => {
    const sharedId = new ObjectId().toHexString();

    // First write succeeds
    const first = makeOutcome({ _id: sharedId, correlationId: 'first' });
    await repo.bulkWriteOutcomes([first]);

    // Second write: one duplicate, one fresh
    const duplicate = makeOutcome({ _id: sharedId, correlationId: 'dup' });
    const fresh = makeOutcome({ correlationId: 'fresh' });

    const result = await repo.bulkWriteOutcomes([duplicate, fresh]);

    // The fresh one should succeed, the duplicate should fail
    expect(result.succeeded).toContain(fresh._id);
    expect(result.failed).toHaveLength(1);

    const failedEntry = result.failed[0];
    expect(failedEntry).toBeDefined();
    if (failedEntry) {
      expect(failedEntry.id).toBe(sharedId);
      expect(failedEntry.error).toBeTruthy();
    }
  });

  // ── Happy path: findByParcelId ──────────────────────
  it('findByParcelId returns the matching outcome', async () => {
    const outcome = makeOutcome({ parcelId: 'parcel-xyz' });
    await repo.bulkWriteOutcomes([outcome]);

    const found = await repo.findByParcelId('parcel-xyz');
    expect(found).not.toBeNull();
    expect(found?._id).toBe(outcome._id);
    expect(found?.parcelId).toBe('parcel-xyz');
  });

  // ── Boundary: findByParcelId non-existent ───────────
  it('findByParcelId returns null for non-existent parcel', async () => {
    const found = await repo.findByParcelId('nonexistent');
    expect(found).toBeNull();
  });
});
