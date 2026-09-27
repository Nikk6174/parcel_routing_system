import { describe, it, expect } from 'vitest';
import { RuleMatcher } from './rule-matcher.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import type { Rule, Parcel } from './types.js';

const matcher = new RuleMatcher(new ConditionEvaluator());

const testParcel: Parcel = {
  weight: 12,
  value: 500,
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
};

function makeRule(overrides: Partial<Rule>): Rule {
  return {
    _id: 'test-rule',
    name: 'Test Rule',
    version: 1,
    active: true,
    priority: 1,
    type: 'condition_rule',
    conditions: { all: [] },
    action: { route_to: 'test-dept' },
    ...overrides,
  };
}

describe('RuleMatcher', () => {
  // ── Happy path: all conditions ──────────────────────
  it('matches when all conditions are satisfied', () => {
    const rule = makeRule({
      conditions: {
        all: [
          { field: 'weight', operator: '>', value: 10 },
          { field: 'destinationCountry', operator: 'eq', value: 'NL' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(true);
  });

  it('does not match when one all-condition fails', () => {
    const rule = makeRule({
      conditions: {
        all: [
          { field: 'weight', operator: '>', value: 10 },
          { field: 'destinationCountry', operator: 'eq', value: 'DE' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(false);
  });

  // ── any conditions (OR logic) ───────────────────────
  it('matches when at least one any-condition is satisfied', () => {
    const rule = makeRule({
      conditions: {
        any: [
          { field: 'destinationCountry', operator: 'eq', value: 'DE' },
          { field: 'destinationCountry', operator: 'eq', value: 'NL' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(true);
  });

  it('does not match when no any-condition is satisfied', () => {
    const rule = makeRule({
      conditions: {
        any: [
          { field: 'destinationCountry', operator: 'eq', value: 'DE' },
          { field: 'destinationCountry', operator: 'eq', value: 'FR' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(false);
  });

  // ── Combined all + any ──────────────────────────────
  it('requires both all and any to pass when both are present', () => {
    const rule = makeRule({
      conditions: {
        all: [{ field: 'weight', operator: '>', value: 10 }],
        any: [
          { field: 'destinationCountry', operator: 'eq', value: 'DE' },
          { field: 'destinationCountry', operator: 'eq', value: 'NL' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(true);
  });

  it('fails when all passes but any does not', () => {
    const rule = makeRule({
      conditions: {
        all: [{ field: 'weight', operator: '>', value: 10 }],
        any: [
          { field: 'destinationCountry', operator: 'eq', value: 'DE' },
          { field: 'destinationCountry', operator: 'eq', value: 'FR' },
        ],
      },
    });
    expect(matcher.match(rule, testParcel)).toBe(false);
  });

  // ── Boundary: no conditions ─────────────────────────
  it('matches vacuously when no conditions are present', () => {
    const rule = makeRule({ conditions: {} });
    expect(matcher.match(rule, testParcel)).toBe(true);
  });

  it('matches vacuously when conditions arrays are empty', () => {
    const rule = makeRule({ conditions: { all: [], any: [] } });
    expect(matcher.match(rule, testParcel)).toBe(true);
  });

  // ── Invalid: bad field in condition ─────────────────
  it('throws when a condition references an unknown field', () => {
    const rule = makeRule({
      conditions: {
        all: [{ field: 'badField', operator: 'eq', value: 'x' }],
      },
    });
    expect(() => matcher.match(rule, testParcel)).toThrow();
  });
});
