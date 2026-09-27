import type { Rule, Parcel } from './types.js';
import type { ConditionEvaluator } from './condition-evaluator.js';

/**
 * Evaluates a single Rule's conditions block against a Parcel.
 *
 * Logic:
 * - `conditions.all` (AND): every condition must be satisfied.
 * - `conditions.any` (OR):  at least one condition must be satisfied.
 * - If both are present, both groups must pass.
 * - If neither is present (or both are empty), the rule matches vacuously.
 *
 * Receives a ConditionEvaluator via constructor injection for testability.
 * Independent of — and unit-testable without — the RuleEngine.
 */
export class RuleMatcher {
  constructor(private readonly evaluator: ConditionEvaluator) {}

  /**
   * Test whether a rule's conditions match the given parcel.
   */
  match(rule: Rule, parcel: Parcel): boolean {
    const { conditions } = rule;

    // AND group — every condition must pass
    if (conditions.all && conditions.all.length > 0) {
      const allPass = conditions.all.every((c) => this.evaluator.evaluate(c, parcel));
      if (!allPass) return false;
    }

    // OR group — at least one condition must pass
    if (conditions.any && conditions.any.length > 0) {
      const anyPass = conditions.any.some((c) => this.evaluator.evaluate(c, parcel));
      if (!anyPass) return false;
    }

    return true;
  }
}
