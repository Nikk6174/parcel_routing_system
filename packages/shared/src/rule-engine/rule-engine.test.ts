import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rule-engine.js';
import { RuleMatcher } from './rule-matcher.js';
import { ConditionEvaluator } from './condition-evaluator.js';
import { RuleConflictError } from './errors.js';
import type { Rule, Parcel } from './types.js';

const engine = new RuleEngine(new RuleMatcher(new ConditionEvaluator()));

function makeParcel(overrides: Partial<Parcel> = {}): Parcel {
  return {
    weight: 5,
    value: 100,
    destinationCountry: 'NL',
    recipient: {
      name: 'Test Recipient',
      address: {
        street: 'Keizersgracht',
        houseNumber: '100',
        postalCode: '1015 AA',
        city: 'Amsterdam',
      },
    },
    custom: {},
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule>): Rule {
  return {
    _id: 'default-rule',
    name: 'Default Rule',
    version: 1,
    active: true,
    priority: 10,
    type: 'condition_rule',
    conditions: { all: [] },
    action: { route_to: 'default-dept' },
    ...overrides,
  };
}

describe('RuleEngine', () => {
  // ── SPEC TEST: exact weight boundary values ─────────
  describe('weight boundaries (spec: 1, 1.01, 10, 10.01)', () => {
    const weightRule = makeRule({
      _id: 'heavy',
      name: 'Heavy Parcels',
      priority: 1,
      conditions: { all: [{ field: 'weight', operator: '>', value: 10 }] },
      action: { route_to: 'heavy-dept' },
    });

    it('weight 1 does NOT match > 10', () => {
      const result = engine.evaluate(makeParcel({ weight: 1 }), [weightRule]);
      expect(result.status).toBe('UNROUTED');
    });

    it('weight 1.01 does NOT match > 10', () => {
      const result = engine.evaluate(makeParcel({ weight: 1.01 }), [weightRule]);
      expect(result.status).toBe('UNROUTED');
    });

    it('weight 10 does NOT match > 10 (exact boundary)', () => {
      const result = engine.evaluate(makeParcel({ weight: 10 }), [weightRule]);
      expect(result.status).toBe('UNROUTED');
    });

    it('weight 10.01 DOES match > 10 (just above boundary)', () => {
      const result = engine.evaluate(makeParcel({ weight: 10.01 }), [weightRule]);
      expect(result.status).toBe('ROUTED');
      expect(result.department).toBe('heavy-dept');
      expect(result.matchedRuleId).toBe('heavy');
    });
  });

  // ── SPEC TEST: exact value boundary values ──────────
  describe('value boundaries (spec: 1000, 1000.01)', () => {
    const valueRule = makeRule({
      _id: 'high-value',
      name: 'High Value Parcels',
      priority: 1,
      conditions: { all: [{ field: 'value', operator: '>', value: 1000 }] },
      action: { route_to: 'high-value-dept' },
    });

    it('value 1000 does NOT match > 1000 (exact boundary)', () => {
      const result = engine.evaluate(makeParcel({ value: 1000 }), [valueRule]);
      expect(result.status).toBe('UNROUTED');
    });

    it('value 1000.01 DOES match > 1000', () => {
      const result = engine.evaluate(makeParcel({ value: 1000.01 }), [valueRule]);
      expect(result.status).toBe('ROUTED');
      expect(result.department).toBe('high-value-dept');
    });
  });

  // ── SPEC TEST: precondition AND routing rule ────────
  describe('precondition + routing rule simultaneously', () => {
    it('returns PENDING_APPROVAL when precondition has block_until_approved=true', () => {
      const precondition = makeRule({
        _id: 'customs-check',
        name: 'Customs Check',
        type: 'precondition_rule',
        priority: 1,
        conditions: { all: [{ field: 'value', operator: '>', value: 500 }] },
        action: { require_approval: 'customs', block_until_approved: true },
      });

      const routingRule = makeRule({
        _id: 'high-value-route',
        name: 'High Value Route',
        type: 'condition_rule',
        priority: 1,
        conditions: { all: [{ field: 'value', operator: '>', value: 500 }] },
        action: { route_to: 'high-value-dept' },
      });

      const result = engine.evaluate(makeParcel({ value: 600 }), [
        precondition,
        routingRule,
      ]);

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(result.department).toBe('high-value-dept');
      expect(result.requiresApproval).toBe('customs');
      expect(result.matchedRuleId).toBe('high-value-route');
    });

    it('returns ROUTED with requiresApproval when block_until_approved is false', () => {
      const precondition = makeRule({
        _id: 'notify-customs',
        name: 'Notify Customs',
        type: 'precondition_rule',
        priority: 1,
        conditions: { all: [{ field: 'value', operator: '>', value: 500 }] },
        action: { require_approval: 'customs', block_until_approved: false },
      });

      const routingRule = makeRule({
        _id: 'route-1',
        name: 'Value Route',
        type: 'condition_rule',
        priority: 1,
        conditions: { all: [{ field: 'value', operator: '>', value: 500 }] },
        action: { route_to: 'value-dept' },
      });

      const result = engine.evaluate(makeParcel({ value: 600 }), [
        precondition,
        routingRule,
      ]);

      expect(result.status).toBe('ROUTED');
      expect(result.requiresApproval).toBe('customs');
      expect(result.department).toBe('value-dept');
    });
  });

  // ── SPEC TEST: no routing rule matches (UNROUTED) ───
  describe('UNROUTED', () => {
    it('returns UNROUTED when no condition_rule matches', () => {
      const rule = makeRule({
        _id: 'heavy',
        name: 'Heavy Only',
        conditions: { all: [{ field: 'weight', operator: '>', value: 100 }] },
        action: { route_to: 'heavy-dept' },
      });

      const result = engine.evaluate(makeParcel({ weight: 5 }), [rule]);

      expect(result.status).toBe('UNROUTED');
      expect(result.department).toBeNull();
      expect(result.matchedRuleId).toBeNull();
      expect(result.matchedRuleVersion).toBeNull();
      expect(result.reason).toBe('No routing rule matched');
    });

    it('returns UNROUTED with empty rule set', () => {
      const result = engine.evaluate(makeParcel(), []);
      expect(result.status).toBe('UNROUTED');
    });
  });

  // ── SPEC TEST: same-priority conflict ───────────────
  describe('RuleConflictError', () => {
    it('throws when two condition_rules at the same priority both match', () => {
      const ruleA = makeRule({
        _id: 'rule-a',
        name: 'Rule A',
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-a' },
      });
      const ruleB = makeRule({
        _id: 'rule-b',
        name: 'Rule B',
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-b' },
      });

      expect(() =>
        engine.evaluate(makeParcel({ weight: 5 }), [ruleA, ruleB]),
      ).toThrow(RuleConflictError);
    });

    it('conflict error names both rule ids', () => {
      const ruleA = makeRule({
        _id: 'rule-x',
        name: 'Rule X',
        priority: 5,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-x' },
      });
      const ruleB = makeRule({
        _id: 'rule-y',
        name: 'Rule Y',
        priority: 5,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-y' },
      });

      try {
        engine.evaluate(makeParcel({ weight: 5 }), [ruleA, ruleB]);
        expect.fail('Should have thrown RuleConflictError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RuleConflictError);
        const conflict = err as RuleConflictError;
        expect(conflict.ruleIdA).toBe('rule-x');
        expect(conflict.ruleIdB).toBe('rule-y');
        expect(conflict.priority).toBe(5);
      }
    });

    it('does NOT throw when rules at different priorities both match', () => {
      const highPriority = makeRule({
        _id: 'high',
        name: 'High Priority',
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'high-dept' },
      });
      const lowPriority = makeRule({
        _id: 'low',
        name: 'Low Priority',
        priority: 10,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'low-dept' },
      });

      const result = engine.evaluate(makeParcel({ weight: 5 }), [
        highPriority,
        lowPriority,
      ]);
      expect(result.department).toBe('high-dept');
      expect(result.matchedRuleId).toBe('high');
    });
  });

  // ── SPEC TEST: conditions.any (OR logic) ────────────
  describe('OR logic (conditions.any)', () => {
    it('matches when one of the any-conditions is satisfied', () => {
      const rule = makeRule({
        _id: 'multi-country',
        name: 'Multi Country',
        priority: 1,
        conditions: {
          any: [
            { field: 'destinationCountry', operator: 'eq', value: 'DE' },
            { field: 'destinationCountry', operator: 'eq', value: 'NL' },
            { field: 'destinationCountry', operator: 'eq', value: 'BE' },
          ],
        },
        action: { route_to: 'eu-dept' },
      });

      const result = engine.evaluate(
        makeParcel({ destinationCountry: 'NL' }),
        [rule],
      );
      expect(result.status).toBe('ROUTED');
      expect(result.department).toBe('eu-dept');
    });

    it('does not match when none of the any-conditions is satisfied', () => {
      const rule = makeRule({
        _id: 'multi-country',
        name: 'Multi Country',
        priority: 1,
        conditions: {
          any: [
            { field: 'destinationCountry', operator: 'eq', value: 'DE' },
            { field: 'destinationCountry', operator: 'eq', value: 'FR' },
          ],
        },
        action: { route_to: 'eu-dept' },
      });

      const result = engine.evaluate(
        makeParcel({ destinationCountry: 'NL' }),
        [rule],
      );
      expect(result.status).toBe('UNROUTED');
    });
  });

  // ── SPEC TEST: custom field shadowing ───────────────
  describe('custom attribute shadowing system field', () => {
    it('condition evaluates against system field, NOT custom field of same name', () => {
      const rule = makeRule({
        _id: 'weight-check',
        name: 'Weight Check',
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 10 }] },
        action: { route_to: 'heavy-dept' },
      });

      // System weight=5, custom.weight=999
      // Rule evaluates "weight > 10" against system weight (5), not custom (999)
      const parcel = makeParcel({
        weight: 5,
        custom: { weight: 999 },
      });

      const result = engine.evaluate(parcel, [rule]);
      expect(result.status).toBe('UNROUTED');
    });
  });

  // ── Result shape and reason ─────────────────────────
  describe('result details', () => {
    it('includes matched rule id, version, and department', () => {
      const rule = makeRule({
        _id: 'specific-rule',
        name: 'Specific Rule',
        version: 3,
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'target-dept' },
      });

      const result = engine.evaluate(makeParcel({ weight: 5 }), [rule]);

      expect(result.department).toBe('target-dept');
      expect(result.matchedRuleId).toBe('specific-rule');
      expect(result.matchedRuleVersion).toBe(3);
      expect(result.status).toBe('ROUTED');
      expect(result.reason).toContain('Specific Rule');
      expect(result.reason).toContain('weight');
    });

    it('reason for UNROUTED is descriptive', () => {
      const result = engine.evaluate(makeParcel(), []);
      expect(result.reason).toBe('No routing rule matched');
    });
  });

  // ── Priority ordering ──────────────────────────────
  describe('priority ordering', () => {
    it('lower priority number wins (higher precedence)', () => {
      const lowNum = makeRule({
        _id: 'p1',
        name: 'Priority 1',
        priority: 1,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-1' },
      });
      const highNum = makeRule({
        _id: 'p100',
        name: 'Priority 100',
        priority: 100,
        conditions: { all: [{ field: 'weight', operator: '>', value: 1 }] },
        action: { route_to: 'dept-100' },
      });

      // Pass rules in REVERSE order to prove sorting is deterministic
      const result = engine.evaluate(makeParcel({ weight: 5 }), [
        highNum,
        lowNum,
      ]);
      expect(result.department).toBe('dept-1');
      expect(result.matchedRuleId).toBe('p1');
    });
  });
});
