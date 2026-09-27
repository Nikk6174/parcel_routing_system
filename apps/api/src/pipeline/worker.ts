/**
 * Piscina worker file — PURE COMPUTATION ONLY.
 *
 * This module is loaded once per worker thread. The RuleEngine is instantiated
 * at module-load time and reused for all evaluations on that thread.
 *
 * NO database calls, NO I/O, NO side effects — just rule evaluation.
 * The orchestrator (main thread) handles all DB reads/writes.
 */
import {
  RuleEngine,
  RuleMatcher,
  ConditionEvaluator,
} from '@parcel-routing/shared';
import type { WorkerInput, WorkerOutput } from './types.js';

/** Singleton engine per worker thread — created once, reused for every call. */
const engine = new RuleEngine(new RuleMatcher(new ConditionEvaluator()));

/**
 * Evaluate a single parcel against the provided rule set.
 *
 * @param input.parcel The full ParcelDocument (extends Parcel, so the engine accepts it).
 * @param input.rules  The currently-active rules (pre-fetched/cached by the orchestrator).
 * @returns A WorkerOutput with either a result or an error — NEVER throws.
 */
export default function evaluateParcel(input: WorkerInput): WorkerOutput {
  const { parcel, rules } = input;

  try {
    const result = engine.evaluate(parcel, rules);

    return {
      parcelId: parcel._id,
      correlationId: parcel.correlationId,
      result,
      error: null,
    };
  } catch (err: unknown) {
    // Catch all engine errors (RuleConflictError, FieldResolutionError, etc.)
    // and return them as data — never let the worker thread crash.
    const message = err instanceof Error ? err.message : String(err);

    return {
      parcelId: parcel._id,
      correlationId: parcel.correlationId,
      result: null,
      error: `Rule engine error: ${message}`,
    };
  }
}
