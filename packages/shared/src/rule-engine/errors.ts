/**
 * Typed error classes for the rule engine.
 * Every error carries structured context so callers can inspect and handle
 * without parsing error messages.
 */

/**
 * Thrown when two active rules at the same priority both match a parcel.
 *
 * This is a CONFIGURATION ERROR — priority uniqueness should ideally be
 * enforced at the config-validation layer (Phase 3), but the engine must
 * defend against it at runtime too.
 */
export class RuleConflictError extends Error {
  public readonly ruleIdA: string;
  public readonly ruleIdB: string;
  public readonly priority: number;

  constructor(ruleIdA: string, ruleIdB: string, priority: number) {
    super(
      `Rule conflict: rules "${ruleIdA}" and "${ruleIdB}" both match at priority ${String(priority)}. ` +
        `Same-priority conflicts are a configuration error — ensure each priority level is unique.`,
    );
    this.name = 'RuleConflictError';
    this.ruleIdA = ruleIdA;
    this.ruleIdB = ruleIdB;
    this.priority = priority;
  }
}

/**
 * Thrown when a field path in a condition cannot be resolved on the parcel.
 * For example: unknown top-level field, empty path, or bare "custom" without sub-key.
 */
export class FieldResolutionError extends Error {
  public readonly fieldPath: string;

  constructor(fieldPath: string, detail: string) {
    super(`Cannot resolve field "${fieldPath}": ${detail}`);
    this.name = 'FieldResolutionError';
    this.fieldPath = fieldPath;
  }
}

/**
 * Thrown when a condition's operator receives values of incompatible types.
 * For example: applying ">" to a string field value.
 */
export class ConditionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionEvaluationError';
  }
}
