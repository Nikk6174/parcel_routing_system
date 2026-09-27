import { describe, it, expect } from 'vitest';
import evaluateParcel from './worker.js';
import type { WorkerInput } from './types.js';
import type {
  ParcelDocument,
  Rule,
} from '@parcel-routing/shared';
import { PARCEL_STATUS } from '@parcel-routing/shared';

function makeParcel(
  overrides: Partial<ParcelDocument> = {},
): ParcelDocument {
  return {
    _id: 'parcel-1',
    weight: 12,
    value: 500,
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
    status: PARCEL_STATUS.CLAIMED,
    batchId: null,
    correlationId: 'corr-001',
    retryCount: 0,
    claimedBy: 'worker-1',
    claimedAt: new Date(),
    sourceFormat: 'json',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    _id: 'rule-1',
    name: 'Heavy Parcels',
    version: 1,
    active: true,
    priority: 1,
    type: 'condition_rule',
    conditions: {
      all: [{ field: 'weight', operator: '>', value: 10 }],
    },
    action: { route_to: 'heavy-dept' },
    ...overrides,
  };
}

describe('evaluateParcel (worker)', () => {
  // ── Happy path ──────────────────────────────────────
  it('returns ROUTED result when a rule matches', () => {
    const input: WorkerInput = {
      parcel: makeParcel({ weight: 12 }),
      rules: [makeRule()],
    };

    const output = evaluateParcel(input);

    expect(output.error).toBeNull();
    expect(output.result).not.toBeNull();
    expect(output.result?.status).toBe('ROUTED');
    expect(output.result?.department).toBe('heavy-dept');
    expect(output.parcelId).toBe('parcel-1');
    expect(output.correlationId).toBe('corr-001');
  });

  // ── Boundary: UNROUTED ──────────────────────────────
  it('returns UNROUTED when no rule matches', () => {
    const input: WorkerInput = {
      parcel: makeParcel({ weight: 5 }), // Below threshold
      rules: [makeRule()],
    };

    const output = evaluateParcel(input);

    expect(output.error).toBeNull();
    expect(output.result).not.toBeNull();
    expect(output.result?.status).toBe('UNROUTED');
  });

  // ── Invalid: engine throws ──────────────────────────
  it('returns error when the engine throws (e.g. RuleConflictError)', () => {
    // Two same-priority rules that both match → RuleConflictError
    const input: WorkerInput = {
      parcel: makeParcel({ weight: 12 }),
      rules: [
        makeRule({ _id: 'a', name: 'A', priority: 1 }),
        makeRule({ _id: 'b', name: 'B', priority: 1 }),
      ],
    };

    const output = evaluateParcel(input);

    expect(output.result).toBeNull();
    expect(output.error).toBeTruthy();
    expect(output.error).toContain('Rule engine error');
    // Worker does NOT throw — it returns the error as data
    expect(output.parcelId).toBe('parcel-1');
  });

  // ── Empty rules ─────────────────────────────────────
  it('returns UNROUTED with empty rule set', () => {
    const input: WorkerInput = {
      parcel: makeParcel(),
      rules: [],
    };

    const output = evaluateParcel(input);

    expect(output.error).toBeNull();
    expect(output.result?.status).toBe('UNROUTED');
  });
});
