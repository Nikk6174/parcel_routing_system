import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import {
  PARCEL_STATUS,
  type ParcelDocument,
} from '@parcel-routing/shared';
import { ParcelRepository } from '../db/parcel-repository.js';
import { OutcomeRepository } from '../db/outcome-repository.js';
import { RuleRepository } from '../db/rule-repository.js';
import { ensureIndexes } from '../db/indexes.js';
import { PipelineOrchestrator } from './orchestrator.js';
import type { WorkerInput, WorkerOutput, WorkerPool, Logger } from './types.js';

// ── Test helpers ────────────────────────────────────────

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let parcelRepo: ParcelRepository;
let outcomeRepo: OutcomeRepository;
let ruleRepo: RuleRepository;

/** No-op logger that captures error calls for assertions. */
function createTestLogger(): Logger & { errors: Array<{ msg: string; ctx: Record<string, unknown> }> } {
  const errors: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
  return {
    errors,
    info: () => {},
    warn: () => {},
    error: (msg: string, context?: Record<string, unknown>) => {
      errors.push({ msg, ctx: context ?? {} });
    },
  };
}

function createMockPool(
  handler: (data: WorkerInput) => WorkerOutput | Promise<WorkerOutput>,
): WorkerPool {
  return {
    run: async (data) => handler(data),
    destroy: async () => {},
  };
}

function makeSuccessOutput(parcel: ParcelDocument): WorkerOutput {
  return {
    parcelId: parcel._id,
    correlationId: parcel.correlationId,
    result: {
      department: 'test-dept',
      matchedRuleId: 'rule-1',
      matchedRuleVersion: 1,
      reason: 'Matched test rule',
      requiresApproval: null,
      status: 'ROUTED',
    },
    error: null,
  };
}

async function insertParcel(
  overrides: Partial<Omit<ParcelDocument, '_id'>> = {},
): Promise<ParcelDocument> {
  return parcelRepo.insertOne({
    weight: 10,
    value: 100,
    destinationCountry: 'NL',
    recipient: {
      name: 'Test',
      address: {
        street: 'St',
        houseNumber: '1',
        postalCode: '1000',
        city: 'Amsterdam',
      },
    },
    custom: {},
    status: PARCEL_STATUS.RECEIVED,
    batchId: null,
    correlationId: `corr-${Date.now()}-${String(Math.random()).slice(2, 8)}`,
    retryCount: 0,
    claimedBy: null,
    claimedAt: null,
    sourceFormat: 'json',
    createdAt: new Date(),
    ...overrides,
  });
}

async function insertActiveRule(): Promise<void> {
  await ruleRepo.create({
    name: 'Test Rule',
    priority: 1,
    type: 'condition_rule',
    conditions: {
      all: [{ field: 'weight', operator: '>', value: 5 }],
    },
    action: { route_to: 'test-dept' },
    createdBy: 'test',
  });
}

// ── Setup / teardown ────────────────────────────────────

describe('PipelineOrchestrator', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_pipeline');
    await ensureIndexes(db);
    parcelRepo = new ParcelRepository(db);
    outcomeRepo = new OutcomeRepository(db);
    ruleRepo = new RuleRepository(db);
  }, 30_000);

  afterEach(async () => {
    await db.collection('parcels').deleteMany({});
    await db.collection('outcomes').deleteMany({});
    await db.collection('routing_rules').deleteMany({});
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  // ── SPEC TEST: partial failures don't crash pipeline ──
  it('handles partial rule-engine failures without crashing', async () => {
    await insertActiveRule();

    // Insert 5 parcels
    const parcels: ParcelDocument[] = [];
    for (let i = 0; i < 5; i++) {
      parcels.push(await insertParcel({ correlationId: `corr-${String(i)}` }));
    }

    // Mock pool: parcels at index 1 and 3 fail, others succeed
    const failingIds = new Set([parcels[1]?._id, parcels[3]?._id]);
    const mockPool = createMockPool((data) => {
      if (failingIds.has(data.parcel._id)) {
        throw new Error('Simulated engine failure');
      }
      return makeSuccessOutput(data.parcel);
    });

    const logger = createTestLogger();
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      mockPool,
      {
        batchSize: 10,
        bufferMaxSize: 100,
        bufferFlushIntervalMs: 60_000,
        claimIntervalMs: 1_000,
        staleSweepIntervalMs: 60_000,
        staleAfterMs: 300_000,
        maxRetries: 3,
        ruleCacheTtlMs: 0, // Always refresh
      },
      logger,
    );

    // Run one cycle + flush
    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // Assert: 3 parcels routed (outcomes written)
    const outcomes = await db.collection('outcomes').find({}).toArray();
    expect(outcomes).toHaveLength(3);

    // Assert: 2 failed parcels retried (status back to RECEIVED, retryCount=1)
    for (const failId of failingIds) {
      if (!failId) continue;
      const parcel = await parcelRepo.findById(failId);
      expect(parcel?.status).toBe(PARCEL_STATUS.RECEIVED);
      expect(parcel?.retryCount).toBe(1);
    }

    // Assert: 3 successful parcels have status ROUTED
    for (const p of parcels) {
      if (failingIds.has(p._id)) continue;
      const parcel = await parcelRepo.findById(p._id);
      expect(parcel?.status).toBe(PARCEL_STATUS.ROUTED);
    }
  });

  // ── SPEC TEST: max retries → FAILED ───────────────────
  it('marks parcel as FAILED after exceeding max retries', async () => {
    await insertActiveRule();

    // Insert parcel with retryCount = 2 (one below max of 3)
    const parcel = await insertParcel({
      retryCount: 2,
      correlationId: 'corr-retry-max',
    });

    // Mock pool: always returns error
    const mockPool = createMockPool((data) => ({
      parcelId: data.parcel._id,
      correlationId: data.parcel.correlationId,
      result: null,
      error: 'Persistent engine failure',
    }));

    const logger = createTestLogger();
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      mockPool,
      {
        batchSize: 10,
        bufferMaxSize: 100,
        bufferFlushIntervalMs: 60_000,
        claimIntervalMs: 1_000,
        staleSweepIntervalMs: 60_000,
        staleAfterMs: 300_000,
        maxRetries: 3,
        ruleCacheTtlMs: 0,
      },
      logger,
    );

    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // Assert: parcel is FAILED (not back to RECEIVED)
    const updatedParcel = await parcelRepo.findById(parcel._id);
    expect(updatedParcel?.status).toBe(PARCEL_STATUS.FAILED);
    // retryCount was 2, now 3 (incremented by markFailed)
    expect(updatedParcel?.retryCount).toBe(3);

    // Assert: a FAILED outcome was written
    const outcome = await outcomeRepo.findByParcelId(parcel._id);
    expect(outcome).not.toBeNull();
    expect(outcome?.status).toBe(PARCEL_STATUS.FAILED);
    expect(outcome?.reason).toContain('Persistent engine failure');

    // Assert: error was logged with full context
    const errorLog = logger.errors.find(
      (e) => e.msg === 'Parcel permanently failed after max retries',
    );
    expect(errorLog).toBeDefined();
    expect(errorLog?.ctx['correlationId']).toBe('corr-retry-max');
    expect(errorLog?.ctx['parcelId']).toBe(parcel._id);
  });

  // ── UNROUTED parcels fail immediately ────────────────
  it('fails UNROUTED parcels immediately (does not retry)', async () => {
    await insertActiveRule();

    const parcel = await insertParcel({
      weight: 1, // Won't match rule (weight > 5)
      correlationId: 'corr-unrouted',
    });

    // Mock pool returns the actual engine result (UNROUTED)
    const mockPool = createMockPool((data) => ({
      parcelId: data.parcel._id,
      correlationId: data.parcel.correlationId,
      result: {
        department: null,
        matchedRuleId: null,
        matchedRuleVersion: null,
        reason: 'No routing rule matched',
        requiresApproval: null,
        status: 'UNROUTED' as const,
      },
      error: null,
    }));

    const logger = createTestLogger();
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      mockPool,
      {
        batchSize: 10,
        bufferMaxSize: 100,
        bufferFlushIntervalMs: 60_000,
        claimIntervalMs: 1_000,
        staleSweepIntervalMs: 60_000,
        staleAfterMs: 300_000,
        maxRetries: 3,
        ruleCacheTtlMs: 0,
      },
      logger,
    );

    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // Assert: outcome written as FAILED (not retried)
    const outcome = await outcomeRepo.findByParcelId(parcel._id);
    expect(outcome).not.toBeNull();
    expect(outcome?.status).toBe(PARCEL_STATUS.FAILED);

    // Assert: parcel status is FAILED
    const updatedParcel = await parcelRepo.findById(parcel._id);
    expect(updatedParcel?.status).toBe(PARCEL_STATUS.FAILED);
  });

  // ── No parcels available ──────────────────────────────
  it('handles empty batch gracefully', async () => {
    await insertActiveRule();

    const mockPool = createMockPool(() => {
      throw new Error('Should not be called');
    });

    const logger = createTestLogger();
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      mockPool,
      {
        batchSize: 10,
        bufferMaxSize: 100,
        bufferFlushIntervalMs: 60_000,
        claimIntervalMs: 1_000,
        staleSweepIntervalMs: 60_000,
        staleAfterMs: 300_000,
        maxRetries: 3,
        ruleCacheTtlMs: 0,
      },
      logger,
    );

    // Should not throw when no parcels exist
    await expect(orchestrator.processCycle()).resolves.not.toThrow();
  });

  // ── HEADLINE TEST: live rule extension without redeploy ──
  it('routes a parcel using a rule created after pipeline init — no sleep, no redeploy', async () => {
    /**
     * THIS TEST PROVES THE HEADLINE FEATURE:
     * "Modify or extend routing logic live"
     *
     * Scenario:
     * 1. Pipeline starts with NO rules (cache is warm but empty)
     * 2. Admin creates a rule via ruleRepo (simulating POST /rules)
     * 3. invalidateRuleCache() is called (same as the route handler does)
     * 4. A parcel matching ONLY the new rule is submitted
     * 5. One processCycle() runs — the parcel routes successfully
     *
     * No sleep, no wait, no TTL expiry — the new rule takes effect
     * on the very next cycle after invalidation.
     */

    // Use the REAL rule engine (not a mock) to prove end-to-end correctness.
    // The mock pool calls the actual shared RuleEngine.
    const { RuleEngine, RuleMatcher, ConditionEvaluator } = await import('@parcel-routing/shared');
    const engine = new RuleEngine(new RuleMatcher(new ConditionEvaluator()));

    const realPool = createMockPool((data: WorkerInput): WorkerOutput => {
      try {
        const result = engine.evaluate(data.parcel, data.rules);
        return {
          parcelId: data.parcel._id,
          correlationId: data.parcel.correlationId,
          result,
          error: null,
        };
      } catch (err: unknown) {
        return {
          parcelId: data.parcel._id,
          correlationId: data.parcel.correlationId,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const logger = createTestLogger();

    // Use a LONG TTL (10 minutes) to prove that the cache invalidation
    // is what triggers the refresh — NOT the TTL expiring.
    const orchestrator = new PipelineOrchestrator(
      parcelRepo,
      outcomeRepo,
      ruleRepo,
      realPool,
      {
        batchSize: 10,
        bufferMaxSize: 100,
        bufferFlushIntervalMs: 60_000,
        claimIntervalMs: 1_000,
        staleSweepIntervalMs: 60_000,
        staleAfterMs: 300_000,
        maxRetries: 3,
        ruleCacheTtlMs: 600_000, // 10 minutes — will NOT expire during test
      },
      logger,
    );

    // STEP 1: Warm the cache — it loads an EMPTY rule set.
    await orchestrator.processCycle();
    // (No parcels, no rules — that's fine, cache is now warm)

    // STEP 2: Admin creates a rule (simulates POST /rules handler).
    await ruleRepo.create({
      name: 'Live Belgium Rule',
      priority: 1,
      type: 'condition_rule',
      conditions: {
        all: [{ field: 'destinationCountry', operator: 'eq', value: 'BE' }],
      },
      action: { route_to: 'belgium-desk' },
      createdBy: 'admin-test',
    });

    // STEP 3: Invalidate cache (this is what the route handler calls
    // via the onRuleChange callback after writing to MongoDB).
    orchestrator.invalidateRuleCache();

    // STEP 4: Submit a parcel that matches ONLY the new rule.
    const parcel = await insertParcel({
      destinationCountry: 'BE',
      weight: 2, // won't match any "weight > X" rule
      correlationId: 'corr-live-rule-test',
    });

    // STEP 5: Process one cycle — NO sleep, NO wait.
    await orchestrator.processCycle();
    await orchestrator.flushBuffer();

    // ASSERT: Parcel is ROUTED (not UNROUTED, not stuck in RECEIVED).
    const updatedParcel = await parcelRepo.findById(parcel._id);
    expect(updatedParcel?.status).toBe(PARCEL_STATUS.ROUTED);

    // ASSERT: Outcome references the new rule's department.
    const outcome = await outcomeRepo.findByParcelId(parcel._id);
    expect(outcome).not.toBeNull();
    expect(outcome?.department).toBe('belgium-desk');
    expect(outcome?.status).toBe(PARCEL_STATUS.ROUTED);
  });
});

