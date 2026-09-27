import { ConditionEvaluationError } from './errors.js';

/**
 * A function that compares a resolved field value against a condition value.
 * Returns true if the condition is satisfied.
 */
export type OperatorFn = (fieldValue: unknown, conditionValue: unknown) => boolean;

/**
 * Operator registry — a lookup map from operator name to comparison function.
 *
 * EXTENSIBILITY (Open/Closed Principle):
 * To add a new operator, call registerOperator() from outside this module.
 * No need to modify ConditionEvaluator, RuleMatcher, or RuleEngine.
 */
const registry = new Map<string, OperatorFn>();

/**
 * Register a named operator.
 * Overwrites any previous registration with the same name.
 *
 * @param name - Operator identifier (e.g. 'contains', 'regex').
 * @param fn   - Comparison function: (fieldValue, conditionValue) => boolean.
 */
export function registerOperator(name: string, fn: OperatorFn): void {
  registry.set(name, fn);
}

/**
 * Retrieve a registered operator by name.
 * @throws ConditionEvaluationError if the operator is not registered.
 */
export function getOperator(name: string): OperatorFn {
  const fn = registry.get(name);
  if (!fn) {
    throw new ConditionEvaluationError(
      `Unknown operator "${name}". Registered operators: ${[...registry.keys()].join(', ')}`,
    );
  }
  return fn;
}

// ── Helpers ─────────────────────────────────────────────

function assertNumber(val: unknown, label: string): number {
  if (typeof val !== 'number' || Number.isNaN(val)) {
    throw new ConditionEvaluationError(
      `${label} must be a number, got ${typeof val}: ${String(val)}`,
    );
  }
  return val;
}

function assertArray(val: unknown, label: string): unknown[] {
  if (!Array.isArray(val)) {
    throw new ConditionEvaluationError(
      `${label} must be an array, got ${typeof val}: ${String(val)}`,
    );
  }
  return val;
}

// ── Built-in operators ──────────────────────────────────

registerOperator('eq', (field, cond) => field === cond);
registerOperator('neq', (field, cond) => field !== cond);

registerOperator('>', (field, cond) => {
  return assertNumber(field, 'Field value') > assertNumber(cond, 'Condition value');
});

registerOperator('>=', (field, cond) => {
  return assertNumber(field, 'Field value') >= assertNumber(cond, 'Condition value');
});

registerOperator('<', (field, cond) => {
  return assertNumber(field, 'Field value') < assertNumber(cond, 'Condition value');
});

registerOperator('<=', (field, cond) => {
  return assertNumber(field, 'Field value') <= assertNumber(cond, 'Condition value');
});

registerOperator('in', (field, cond) => {
  const arr = assertArray(cond, 'Condition value for "in"');
  return arr.includes(field);
});

registerOperator('not_in', (field, cond) => {
  const arr = assertArray(cond, 'Condition value for "not_in"');
  return !arr.includes(field);
});
