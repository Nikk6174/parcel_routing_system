import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { ParcelRepository } from './parcel-repository.js';
import { ensureIndexes } from './indexes.js';
import { PARCEL_STATUS, type ParcelDocument } from '@parcel-routing/shared';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: ParcelRepository;

function validParcel(
  overrides: Partial<Omit<ParcelDocument, '_id'>> = {},
): Omit<ParcelDocument, '_id'> {
  return {
    weight: 5,
    value: 100,
    destinationCountry: 'NL',
    recipient: {
      name: 'Jan',
      address: {
        street: 'Keizersgracht',
        houseNumber: '100',
        postalCode: '1015 AA',
        city: 'Amsterdam',
      },
    },
    custom: {},
    status: PARCEL_STATUS.RECEIVED,
    batchId: null,
    correlationId: 'corr-001',
    retryCount: 0,
    claimedBy: null,
    claimedAt: null,
    sourceFormat: 'json',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('ParcelRepository', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_parcels');
    await ensureIndexes(db);
    repo = new ParcelRepository(db);
  }, 30_000);

  afterEach(async () => {
    await db.collection('parcels').deleteMany({});
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  // ── Happy path: insert + claim ──────────────────────
  it('inserts a parcel and claimNext returns it', async () => {
    const inserted = await repo.insertOne(validParcel());

    const claimed = await repo.claimNext('worker-1');

    expect(claimed).not.toBeNull();
    expect(claimed?._id).toBe(inserted._id);
    expect(claimed?.status).toBe(PARCEL_STATUS.CLAIMED);
    expect(claimed?.claimedBy).toBe('worker-1');
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
  });

  // ── Happy path: claimNext returns null when empty ───
  it('claimNext returns null when no RECEIVED parcels exist', async () => {
    const result = await repo.claimNext('worker-1');
    expect(result).toBeNull();
  });

  // ── Happy path: claimNext processes FIFO ────────────
  it('claimNext returns oldest parcel first (FIFO)', async () => {
    const old = new Date('2024-01-01');
    const recent = new Date('2024-06-01');

    await repo.insertOne(
      validParcel({ correlationId: 'recent', createdAt: recent }),
    );
    await repo.insertOne(
      validParcel({ correlationId: 'old', createdAt: old }),
    );

    const claimed = await repo.claimNext('worker-1');
    expect(claimed?.correlationId).toBe('old');
  });

  // ── SPEC-REQUIRED: concurrent claimNext atomicity ───
  it('exactly one of N concurrent callers gets a single parcel', async () => {
    await repo.insertOne(validParcel({ correlationId: 'contested' }));

    const CONCURRENCY = 10;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        repo.claimNext(`worker-${String(i)}`),
      ),
    );

    const claimed = results.filter(
      (r): r is ParcelDocument => r !== null,
    );

    // Exactly one worker should have received the parcel
    expect(claimed).toHaveLength(1);

    const winner = claimed[0];
    expect(winner).toBeDefined();
    if (winner) {
      expect(winner.status).toBe(PARCEL_STATUS.CLAIMED);
      expect(winner.correlationId).toBe('contested');
    }
  });

  // ── Happy path: recoverStaleClaims ──────────────────
  it('resets stale claims back to RECEIVED', async () => {
    // Insert a parcel and claim it
    const inserted = await repo.insertOne(validParcel());
    await repo.claimNext('stale-worker');

    // Manually backdate the claimedAt to simulate staleness
    await db.collection<ParcelDocument>('parcels').updateOne(
      { _id: inserted._id },
      { $set: { claimedAt: new Date(Date.now() - 600_000) } }, // 10 min ago
    );

    const recovered = await repo.recoverStaleClaims(300_000); // 5 min threshold
    expect(recovered).toBe(1);

    const parcel = await repo.findById(inserted._id);
    expect(parcel?.status).toBe(PARCEL_STATUS.RECEIVED);
    expect(parcel?.claimedBy).toBeNull();
    expect(parcel?.claimedAt).toBeNull();
    expect(parcel?.retryCount).toBe(1);
  });

  // ── Boundary: recoverStaleClaims with nothing stale ─
  it('recoverStaleClaims returns 0 when nothing is stale', async () => {
    await repo.insertOne(validParcel());
    await repo.claimNext('worker-1');

    // Claim was just made, not stale yet
    const recovered = await repo.recoverStaleClaims(300_000);
    expect(recovered).toBe(0);
  });

  // ── Happy path: updateStatus ────────────────────────
  it('updateStatus changes the parcel status', async () => {
    const parcel = await repo.insertOne(validParcel());

    const updated = await repo.updateStatus(
      parcel._id,
      PARCEL_STATUS.ROUTED,
    );
    expect(updated).toBe(true);

    const found = await repo.findById(parcel._id);
    expect(found?.status).toBe(PARCEL_STATUS.ROUTED);
  });

  // ── Boundary: updateStatus non-existent ─────────────
  it('updateStatus returns false for non-existent id', async () => {
    const updated = await repo.updateStatus(
      'nonexistent',
      PARCEL_STATUS.ROUTED,
    );
    expect(updated).toBe(false);
  });
});
