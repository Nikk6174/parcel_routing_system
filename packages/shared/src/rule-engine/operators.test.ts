import { describe, it, expect } from 'vitest';
import { getOperator, registerOperator } from './operators.js';

describe('operators', () => {
  // ── eq ──────────────────────────────────────────────
  describe('eq', () => {
    const eq = getOperator('eq');

    it('returns true for equal numbers', () => {
      expect(eq(10, 10)).toBe(true);
    });

    it('returns false for different numbers', () => {
      expect(eq(10, 20)).toBe(false);
    });

    it('uses strict equality (string vs number)', () => {
      expect(eq('10', 10)).toBe(false);
    });

    it('compares strings correctly', () => {
      expect(eq('NL', 'NL')).toBe(true);
    });
  });

  // ── neq ─────────────────────────────────────────────
  describe('neq', () => {
    const neq = getOperator('neq');

    it('returns true for different values', () => {
      expect(neq(10, 20)).toBe(true);
    });

    it('returns false for equal values', () => {
      expect(neq(10, 10)).toBe(false);
    });
  });

  // ── > ───────────────────────────────────────────────
  describe('>', () => {
    const gt = getOperator('>');

    it('returns true when field > condition', () => {
      expect(gt(11, 10)).toBe(true);
    });

    it('returns false when field === condition (boundary)', () => {
      expect(gt(10, 10)).toBe(false);
    });

    it('boundary: 10.01 > 10 is true', () => {
      expect(gt(10.01, 10)).toBe(true);
    });

    it('boundary: 1000.01 > 1000 is true', () => {
      expect(gt(1000.01, 1000)).toBe(true);
    });

    it('throws on non-numeric field value', () => {
      expect(() => gt('abc', 10)).toThrow('must be a number');
    });

    it('throws on non-numeric condition value', () => {
      expect(() => gt(10, 'abc')).toThrow('must be a number');
    });
  });

  // ── >= ──────────────────────────────────────────────
  describe('>=', () => {
    const gte = getOperator('>=');

    it('returns true when equal', () => {
      expect(gte(10, 10)).toBe(true);
    });

    it('returns true when greater', () => {
      expect(gte(11, 10)).toBe(true);
    });

    it('returns false when less', () => {
      expect(gte(9, 10)).toBe(false);
    });
  });

  // ── < ───────────────────────────────────────────────
  describe('<', () => {
    const lt = getOperator('<');

    it('returns true when field < condition', () => {
      expect(lt(9, 10)).toBe(true);
    });

    it('returns false when equal (boundary)', () => {
      expect(lt(10, 10)).toBe(false);
    });

    it('returns false when greater', () => {
      expect(lt(11, 10)).toBe(false);
    });
  });

  // ── <= ──────────────────────────────────────────────
  describe('<=', () => {
    const lte = getOperator('<=');

    it('returns true when equal', () => {
      expect(lte(10, 10)).toBe(true);
    });

    it('returns true when less', () => {
      expect(lte(9, 10)).toBe(true);
    });

    it('returns false when greater', () => {
      expect(lte(11, 10)).toBe(false);
    });
  });

  // ── in ──────────────────────────────────────────────
  describe('in', () => {
    const opIn = getOperator('in');

    it('returns true when value is in array', () => {
      expect(opIn('NL', ['NL', 'BE', 'DE'])).toBe(true);
    });

    it('returns false when value is not in array', () => {
      expect(opIn('US', ['NL', 'BE', 'DE'])).toBe(false);
    });

    it('throws when condition value is not an array', () => {
      expect(() => opIn('NL', 'NL')).toThrow('must be an array');
    });
  });

  // ── not_in ──────────────────────────────────────────
  describe('not_in', () => {
    const notIn = getOperator('not_in');

    it('returns true when value is NOT in array', () => {
      expect(notIn('US', ['NL', 'BE', 'DE'])).toBe(true);
    });

    it('returns false when value IS in array', () => {
      expect(notIn('NL', ['NL', 'BE', 'DE'])).toBe(false);
    });

    it('throws when condition value is not an array', () => {
      expect(() => notIn('NL', 'NL')).toThrow('must be an array');
    });
  });

  // ── getOperator ─────────────────────────────────────
  describe('getOperator', () => {
    it('throws for an unknown operator name', () => {
      expect(() => getOperator('unknown_op')).toThrow('Unknown operator');
    });
  });

  // ── registerOperator (extensibility) ────────────────
  describe('registerOperator', () => {
    it('allows registering and using a custom operator', () => {
      registerOperator('test_contains', (field, cond) => {
        return (
          typeof field === 'string' &&
          typeof cond === 'string' &&
          field.includes(cond)
        );
      });
      expect(getOperator('test_contains')('hello world', 'world')).toBe(true);
      expect(getOperator('test_contains')('hello world', 'xyz')).toBe(false);
    });
  });
});
