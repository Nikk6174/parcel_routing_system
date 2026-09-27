/**
 * Rule Engine — public API.
 *
 * Re-exports all types, classes, errors, and utilities that consumers need.
 * Import from '@parcel-routing/shared' (which re-exports this module).
 */

// ── Classes ──────────────────────────────────────────────
export { ConditionEvaluator } from './condition-evaluator.js';
export { RuleMatcher } from './rule-matcher.js';
export { RuleEngine } from './rule-engine.js';

// ── Operator registry ────────────────────────────────────
export { registerOperator, getOperator } from './operators.js';
export type { OperatorFn } from './operators.js';

// ── Field resolver ───────────────────────────────────────
export { resolveField } from './field-resolver.js';

// ── Errors ───────────────────────────────────────────────
export {
  RuleConflictError,
  FieldResolutionError,
  ConditionEvaluationError,
} from './errors.js';

// ── Types ────────────────────────────────────────────────
export type {
  Rule,
  Condition,
  Parcel,
  RuleEngineResult,
  RuleEngineStatus,
  OperatorType,
  RuleAction,
  ConditionsBlock,
  Address,
  Recipient,
} from './types.js';
