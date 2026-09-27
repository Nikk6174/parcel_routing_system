import type { Condition, Parcel } from './types.js';
import { resolveField } from './field-resolver.js';
import { getOperator } from './operators.js';

/**
 * Evaluates a single Condition against a Parcel.
 *
 * Delegates field resolution to the field-resolver module and operator
 * lookup to the operator registry. Adding a new operator or changing
 * field resolution never requires modifying this class.
 */
export class ConditionEvaluator {
  /**
   * Evaluate whether a condition holds for the given parcel.
   *
   * @param condition The condition to test.
   * @param parcel    The parcel to test against.
   * @returns `true` if the condition is satisfied.
   * @throws FieldResolutionError if the field path is invalid.
   * @throws ConditionEvaluationError if the operator rejects the value types.
   */
  evaluate(condition: Condition, parcel: Parcel): boolean {
    const fieldValue = resolveField(parcel, condition.field);
    const operatorFn = getOperator(condition.operator);
    return operatorFn(fieldValue, condition.value);
  }
}
