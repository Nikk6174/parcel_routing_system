import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { RuleRepository, PriorityConflictError } from './rule-repository.js';
import { ensureIndexes } from './indexes.js';
import type { CreateRuleInput } from './schemas.js';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: RuleRepository;

function validInput(overrides: Partial<CreateRuleInput> = {}): CreateRuleInput {
  return {
    name: 'Test Rule',
    priority: 10,
    type: 'condition_rule',
    conditions: {
      all: [{ field: 'weight', operator: '>', value: 10 }],
    },
    action: { route_to: 'heavy-dept' },
    createdBy: 'test-user',
    ...overrides,
  };
}

describe('RuleRepository', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db('test_rules');
    await ensureIndexes(db);
    repo = new RuleRepository(db);
  }, 30_000);

  afterEach(async () => {
    await db.collection('routing_rules').deleteMany({});
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  // ── Happy path: create ──────────────────────────────
  it('creates a rule with version 1 and active true', async () => {
    const rule = await repo.create(validInput({ name: 'Heavy Parcels' }));

    expect(rule.name).toBe('Heavy Parcels');
    expect(rule.version).toBe(1);
    expect(rule.active).toBe(true);
    expect(rule._id).toBeDefined();
    expect(rule.createdAt).toBeInstanceOf(Date);
    expect(rule.createdBy).toBe('test-user');
  });

  // ── Happy path: findActive ──────────────────────────
  it('findActive returns only active rules sorted by priority', async () => {
    await repo.create(validInput({ name: 'Low', priority: 100 }));
    await repo.create(validInput({ name: 'High', priority: 1 }));
    await repo.create(validInput({ name: 'Mid', priority: 50 }));

    const active = await repo.findActive();

    expect(active).toHaveLength(3);
    expect(active[0]?.name).toBe('High');
    expect(active[1]?.name).toBe('Mid');
    expect(active[2]?.name).toBe('Low');
  });

  // ── Happy path: update creates new version ──────────
  it('update deactivates old version and inserts new version', async () => {
    const v1 = await repo.create(validInput({ name: 'Rule V1', priority: 5 }));

    const v2 = await repo.update(
      v1._id,
      validInput({
        name: 'Rule V2',
        priority: 5,
        conditions: {
          all: [{ field: 'weight', operator: '>', value: 20 }],
        },
      }),
    );

    expect(v2.version).toBe(2);
    expect(v2.active).toBe(true);
    expect(v2._id).not.toBe(v1._id);

    // Old version is now inactive
    const oldRule = await repo.findById(v1._id);
    expect(oldRule?.active).toBe(false);
  });

  // ── Happy path: deactivate ──────────────────────────
  it('deactivate sets active to false', async () => {
    const rule = await repo.create(validInput({ priority: 7 }));

    const result = await repo.deactivate(rule._id);
    expect(result).toBe(true);

    const found = await repo.findById(rule._id);
    expect(found?.active).toBe(false);
  });

  // ── Happy path: findById ────────────────────────────
  it('findById returns the correct rule', async () => {
    const rule = await repo.create(validInput({ priority: 3 }));
    const found = await repo.findById(rule._id);
    expect(found?._id).toBe(rule._id);
  });

  // ── Boundary: findById non-existent ─────────────────
  it('findById returns null for non-existent id', async () => {
    const found = await repo.findById('nonexistent');
    expect(found).toBeNull();
  });

  // ── Boundary: deactivate already-inactive rule ──────
  it('deactivate returns false for already-inactive rule', async () => {
    const rule = await repo.create(validInput({ priority: 8 }));
    await repo.deactivate(rule._id);

    const result = await repo.deactivate(rule._id);
    expect(result).toBe(false);
  });

  // ── Invalid: Zod validation error ───────────────────
  it('rejects rule with empty name', async () => {
    await expect(
      repo.create(validInput({ name: '' })),
    ).rejects.toThrow();
  });

  it('rejects rule with priority 0', async () => {
    await expect(
      repo.create(validInput({ priority: 0 })),
    ).rejects.toThrow();
  });

  it('rejects rule with invalid type', async () => {
    await expect(
      repo.create(validInput({ type: 'bad_type' as 'condition_rule' })),
    ).rejects.toThrow();
  });

  // ── Invalid: priority conflict ──────────────────────
  it('rejects create when another active rule has the same priority', async () => {
    await repo.create(validInput({ name: 'First', priority: 42 }));

    await expect(
      repo.create(validInput({ name: 'Second', priority: 42 })),
    ).rejects.toThrow(PriorityConflictError);
  });

  it('allows same priority after first rule is deactivated', async () => {
    const first = await repo.create(
      validInput({ name: 'First', priority: 99 }),
    );
    await repo.deactivate(first._id);

    const second = await repo.create(
      validInput({ name: 'Second', priority: 99 }),
    );
    expect(second.active).toBe(true);
    expect(second.priority).toBe(99);
  });

  // ── Invalid: update non-existent rule ───────────────
  it('update throws for non-existent rule id', async () => {
    await expect(
      repo.update('nonexistent', validInput({ priority: 1 })),
    ).rejects.toThrow('Rule not found');
  });

  // ── Invalid: update to conflicting priority ─────────
  it('update rejects priority conflict with another active rule', async () => {
    await repo.create(validInput({ name: 'Existing', priority: 20 }));
    const toUpdate = await repo.create(
      validInput({ name: 'Will Update', priority: 30 }),
    );

    await expect(
      repo.update(toUpdate._id, validInput({ name: 'Updated', priority: 20 })),
    ).rejects.toThrow(PriorityConflictError);
  });

  // ── Indexes ─────────────────────────────────────────
  it('ensureIndexes completes without error', async () => {
    await expect(ensureIndexes(db)).resolves.not.toThrow();
  });
});
