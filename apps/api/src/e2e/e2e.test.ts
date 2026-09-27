/**
 * End-to-end tests covering full user journeys.
 *
 * These tests exercise the entire stack: API routes → MongoDB → orchestrator
 * (with real rule engine via worker mock) → outcomes. They prove that a parcel
 * submitted via the API ends up in the correct final state.
 *
 * Each test creates rules, submits parcels via the API, processes them through
 * the orchestrator, and asserts the final outcome.
 *
 * Count: 3 deliberate e2e scenarios (kept small for CI speed).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import {
  PARCEL_STATUS,
  RuleEngine,
  RuleMatcher,
  ConditionEvaluator,
  type RuleEngineResult,
} from '@parcel-routing/shared';
import { createTestApp, TEST_JWT_SECRET } from '../app.js';
import { getSecretKey } from '../security/index.js';
import { ParcelRepository } from '../db/parcel-repository.js';
import { OutcomeRepository } from '../db/outcome-repository.js';
import { RuleRepository } from '../db/rule-repository.js';
import { ensureIndexes } from '../db/indexes.js';
import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { DEFAULT_PIPELINE_CONFIG } from '../pipeline/types.js';
import type { WorkerInput, WorkerOutput, WorkerPool, Logger } from '../pipeline/types.js';

// ── Helpers ─────────────────────────────────────────────

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let app: FastifyInstance;
let parcelRepo: ParcelRepository;
let outcomeRepo: OutcomeRepository;
let ruleRepo: RuleRepository;

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Sign a JWT for a given role. */
async function signToken(role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('e2e-user')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecretKey());
}

async function authHeader(role: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await signToken(role)}` };
}

/**
 * Create a worker pool that uses the REAL rule engine (not mocked).
 * This makes the tests true end-to-end: API → DB → real rule engine → outcome.
 */
function createRealEnginePool(): WorkerPool {
  const engine = new RuleEngine(new RuleMatcher(new ConditionEvaluator()));
  return {
    run: async (data: WorkerInput): Promise<WorkerOutput> => {
      try {
        const result: RuleEngineResult = engine.evaluate(data.parcel, data.rules);
        return {
          parcelId: data.parcel._id,
          correlationId: data.parcel.correlationId,
          result,
          error: null,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          parcelId: data.parcel._id,
          correlationId: data.parcel.correlationId,
          result: null,
          error: `Rule engine error: ${message}`,
        };
      }
    },
    destroy: async () => {},
  };
}

// ── Setup / Teardown ────────────────────────────────────

describe('E2E: Full user journeys', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_e2e');
    await ensureIndexes(db);
    app = await createTestApp(db);
    parcelRepo = new ParcelRepository(db);
    outcomeRepo = new OutcomeRepository(db);
    ruleRepo = new RuleRepository(db);
  }, 30_000);

  afterEach(async () => {
    await db.collection('parcels').deleteMany({});
    await db.collection('outcomes').deleteMany({});
    await db.collection('routing_rules').deleteMany({});
    await db.collection('idempotency_keys').deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await client.close();
    await mongod.stop();
  });

  // ── E2E 1: Single parcel below 1kg → ROUTED to MAIL ──

  it('routes a sub-1kg parcel to MAIL department', async () => {
    // 1. Create a rule: weight < 1 → route to "MAIL"
    const ruleRes = await app.inject({
      method: 'POST',
      url: '/rules',
      headers: await authHeader('admin'),
      payload: {
        name: 'Mail Route',
        priority: 1,
        type: 'condition_rule',
        conditions: {
          all: [{ field: 'weight', operator: '<', value: 1 }],
        },
        action: { route_to: 'MAIL' },
        createdBy: 'e2e-admin',
      },
    });
    expect(ruleRes.statusCode).toBe(201);

    // 2. Submit a parcel weighing 0.5kg via the API
    const parcelRes = await app.inject({
      method: 'POST',
      url: '/parcels',
      headers: await authHeader('operator'),
      payload: {
        weight: 0.5,
        value: 10,
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
      },
    });
    expect(parcelRes.statusCode).toBe(202);
    const { parcelId } = parcelRes.json().data;

    // 3. Process through the orchestrator with the REAL rule engine
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      createRealEnginePool(),
      { ...DEFAULT_PIPELINE_CONFIG, batchSize: 10, bufferMaxSize: 100 },
      noopLogger,
    );

    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // 4. Assert the parcel is ROUTED to MAIL
    const parcel = await parcelRepo.findById(parcelId as string);
    expect(parcel?.status).toBe(PARCEL_STATUS.ROUTED);

    const outcome = await outcomeRepo.findByParcelId(parcelId as string);
    expect(outcome).toBeDefined();
    expect(outcome!.department).toBe('MAIL');
    expect(outcome!.status).toBe(PARCEL_STATUS.ROUTED);
  });

  // ── E2E 2: Batch with mixed outcomes ──────────────────

  it('handles a batch with valid, invalid, and insurance-triggering rows independently', async () => {
    // 1. Create rules:
    //    - weight > 0: route to "STANDARD" (catch-all)
    //    - value > 500: require insurance approval
    const adminHeaders = await authHeader('admin');

    await app.inject({
      method: 'POST',
      url: '/rules',
      headers: adminHeaders,
      payload: {
        name: 'Insurance Check',
        priority: 1,
        type: 'precondition_rule',
        conditions: {
          all: [{ field: 'value', operator: '>', value: 500 }],
        },
        action: { require_approval: 'insurance', block_until_approved: true },
        createdBy: 'e2e-admin',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/rules',
      headers: adminHeaders,
      payload: {
        name: 'Standard Route',
        priority: 10,
        type: 'condition_rule',
        conditions: {
          all: [{ field: 'weight', operator: '>', value: 0 }],
        },
        action: { route_to: 'STANDARD' },
        createdBy: 'e2e-admin',
      },
    });

    // 2. Upload batch: 1 valid, 1 invalid (bad weight), 1 insurance-triggering
    const parcels = [
      {
        weight: 2,
        value: 50,
        destinationCountry: 'NL',
        recipient: {
          name: 'Valid',
          address: { street: 'St', houseNumber: '1', postalCode: '1000', city: 'Amsterdam' },
        },
      },
      {
        weight: 'not-a-number', // INVALID — will be rejected at upload
        value: 50,
        destinationCountry: 'NL',
        recipient: {
          name: 'Invalid',
          address: { street: 'St', houseNumber: '2', postalCode: '2000', city: 'Amsterdam' },
        },
      },
      {
        weight: 3,
        value: 1000, // High value → insurance approval required
        destinationCountry: 'NL',
        recipient: {
          name: 'HighValue',
          address: { street: 'St', houseNumber: '3', postalCode: '3000', city: 'Amsterdam' },
        },
      },
    ];

    const boundary = '---boundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="parcels.json"',
      'Content-Type: application/json',
      '',
      JSON.stringify(parcels),
      `--${boundary}--`,
    ].join('\r\n');

    const batchRes = await app.inject({
      method: 'POST',
      url: '/parcels/batch',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(batchRes.statusCode).toBe(202);
    const batchData = batchRes.json().data;
    expect(batchData.acceptedRows).toBe(2); // valid + high-value
    expect(batchData.rejectedRows).toBe(1); // invalid weight

    // 3. Process through orchestrator
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      createRealEnginePool(),
      { ...DEFAULT_PIPELINE_CONFIG, batchSize: 10, bufferMaxSize: 100 },
      noopLogger,
    );

    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // 4. Assert outcomes
    const allParcels = await db.collection('parcels').find({}).toArray();
    expect(allParcels).toHaveLength(2); // only 2 were accepted

    // The standard parcel should be ROUTED
    const standardParcel = allParcels.find(
      (p) => (p as Record<string, unknown>)['recipient'] &&
        ((p as Record<string, unknown>)['recipient'] as Record<string, unknown>)['name'] === 'Valid',
    );
    expect(standardParcel).toBeDefined();
    expect(standardParcel!['status']).toBe(PARCEL_STATUS.ROUTED);

    // The high-value parcel should be PENDING_APPROVAL
    const highValueParcel = allParcels.find(
      (p) => (p as Record<string, unknown>)['recipient'] &&
        ((p as Record<string, unknown>)['recipient'] as Record<string, unknown>)['name'] === 'HighValue',
    );
    expect(highValueParcel).toBeDefined();
    expect(highValueParcel!['status']).toBe(PARCEL_STATUS.PENDING_APPROVAL);

    // The rejected row never made it to the parcels collection at all
    const invalidParcel = allParcels.find(
      (p) => (p as Record<string, unknown>)['recipient'] &&
        ((p as Record<string, unknown>)['recipient'] as Record<string, unknown>)['name'] === 'Invalid',
    );
    expect(invalidParcel).toBeUndefined();
  });

  // ── E2E 3: Live rule extension without redeploy ───────

  it('adds a rule via API and immediately routes a matching parcel (no redeploy)', async () => {
    // 1. Submit a parcel BEFORE any rules exist
    const parcelRes1 = await app.inject({
      method: 'POST',
      url: '/parcels',
      headers: await authHeader('operator'),
      payload: {
        weight: 25,
        value: 100,
        destinationCountry: 'DE',
        recipient: {
          name: 'Hans',
          address: {
            street: 'Berliner Str',
            houseNumber: '42',
            postalCode: '10115',
            city: 'Berlin',
          },
        },
      },
    });
    expect(parcelRes1.statusCode).toBe(202);
    const parcelId1 = parcelRes1.json().data.parcelId as string;

    // 2. Process — no rules, so parcel stays unrouted (retry/UNROUTED)
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      createRealEnginePool(),
      { ...DEFAULT_PIPELINE_CONFIG, batchSize: 10, maxRetries: 3, bufferMaxSize: 100 },
      noopLogger,
    );

    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // Parcel should be back to RECEIVED (requeued for retry) since UNROUTED triggers retry
    let parcel1 = await parcelRepo.findById(parcelId1);
    expect(parcel1?.status).toBe(PARCEL_STATUS.RECEIVED);

    // 3. NOW add a rule via the API (live, no redeploy)
    const ruleRes = await app.inject({
      method: 'POST',
      url: '/rules',
      headers: await authHeader('admin'),
      payload: {
        name: 'Heavy Germany Route',
        priority: 1,
        type: 'condition_rule',
        conditions: {
          all: [
            { field: 'weight', operator: '>', value: 20 },
            { field: 'destinationCountry', operator: 'eq', value: 'DE' },
          ],
        },
        action: { route_to: 'HEAVY-DE' },
        createdBy: 'e2e-admin',
      },
    });
    expect(ruleRes.statusCode).toBe(201);

    // 4. Invalidate cache (simulating what the API does) and re-process
    orchestrator.invalidateRuleCache();
    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // 5. Assert: the SAME parcel is now ROUTED to HEAVY-DE
    parcel1 = await parcelRepo.findById(parcelId1);
    expect(parcel1?.status).toBe(PARCEL_STATUS.ROUTED);

    const outcome = await outcomeRepo.findByParcelId(parcelId1);
    expect(outcome).toBeDefined();
    expect(outcome!.department).toBe('HEAVY-DE');
    expect(outcome!.status).toBe(PARCEL_STATUS.ROUTED);
  });
});
