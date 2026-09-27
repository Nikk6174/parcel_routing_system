import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from './condition-evaluator.js';
import type { Parcel, Condition } from './types.js';

const evaluator = new ConditionEvaluator();

const testParcel: Parcel = {
  weight: 10,
  value: 1000,
  destinationCountry: 'NL',
  recipient: {
    name: 'Test Recipient',
    address: {
      street: 'Main St',
      houseNumber: '1',
      postalCode: '1000',
      city: 'Amsterdam',
    },
  },
  custom: {},
};

describe('ConditionEvaluator', () => {
  // ── Happy path ──────────────────────────────────────
  it('evaluates a numeric ">" condition correctly', () => {
    const condition: Condition = { field: 'weight', operator: '>', value: 5 };
    expect(evaluator.evaluate(condition, testParcel)).toBe(true);
  });

  it('evaluates a string "eq" condition correctly', () => {
    const condition: Condition = {
      field: 'destinationCountry',
      operator: 'eq',
      value: 'NL',
    };
    expect(evaluator.evaluate(condition, testParcel)).toBe(true);
  });

  it('evaluates an "in" condition correctly', () => {
    const condition: Condition = {
      field: 'destinationCountry',
      operator: 'in',
      value: ['NL', 'BE', 'DE'],
    };
    expect(evaluator.evaluate(condition, testParcel)).toBe(true);
  });

  // ── Boundary ────────────────────────────────────────
  it('weight exactly at boundary (10 > 10 is false)', () => {
    const condition: Condition = {
      field: 'weight',
      operator: '>',
      value: 10,
    };
    expect(evaluator.evaluate(condition, testParcel)).toBe(false);
  });

  it('weight exactly at boundary (10 >= 10 is true)', () => {
    const condition: Condition = {
      field: 'weight',
      operator: '>=',
      value: 10,
    };
    expect(evaluator.evaluate(condition, testParcel)).toBe(true);
  });

  it('value exactly at boundary (1000 > 1000 is false)', () => {
    const condition: Condition = {
      field: 'value',
      operator: '>',
      value: 1000,
    };
    expect(evaluator.evaluate(condition, testParcel)).toBe(false);
  });

  // ── Invalid input ───────────────────────────────────
  it('throws for unknown field path', () => {
    const condition: Condition = {
      field: 'unknownField',
      operator: 'eq',
      value: 'x',
    };
    expect(() => evaluator.evaluate(condition, testParcel)).toThrow(
      'Unknown top-level field',
    );
  });

  it('throws when comparing string to number with ">"', () => {
    // custom.name is a string; operator > expects number
    const parcelWithCustom: Parcel = {
      ...testParcel,
      custom: { name: 'test' },
    };
    const condition: Condition = {
      field: 'custom.name',
      operator: '>',
      value: 10,
    };
    expect(() =>
      evaluator.evaluate(condition, parcelWithCustom),
    ).toThrow('must be a number');
  });
});
