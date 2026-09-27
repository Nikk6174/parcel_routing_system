/**
 * Routing rule engine types.
 *
 * ASSUMPTION: destinationCountry is a required string that the engine receives
 * already populated. The engine does NOT apply a default value. The mapping layer
 * (Phase 5) should default destinationCountry to "NL" when absent from the source
 * data — but this default MUST be confirmed with the data owner before relying
 * on it for any customs/cross-border rule.
 *
 * ASSUMPTION: weight and value are already numbers by the time they reach this
 * engine. Type coercion from raw XML text nodes is an ingestion concern handled
 * at the mapping layer (Phase 5), not here.
 */

/** Supported comparison operators for rule conditions. */
export type OperatorType =
  | 'eq'
  | 'neq'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'not_in';

/** A single condition that compares a parcel field against a value. */
export interface Condition {
  field: string;
  operator: OperatorType;
  value: unknown;
}

/** The action to take when a rule matches. */
export interface RuleAction {
  route_to?: string;
  require_approval?: string;
  block_until_approved?: boolean;
}

/** Conditions block with optional AND/OR groups. */
export interface ConditionsBlock {
  all?: Condition[];
  any?: Condition[];
}

/** A routing or precondition rule. */
export interface Rule {
  _id: string;
  name: string;
  version: number;
  active: boolean;
  priority: number;
  type: 'condition_rule' | 'precondition_rule';
  conditions: ConditionsBlock;
  action: RuleAction;
}

/** Recipient address. */
export interface Address {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
}

/** Parcel recipient. */
export interface Recipient {
  name: string;
  address: Address;
}

/**
 * The parcel shape that the rule engine evaluates against.
 *
 * Custom/optional attributes are namespaced under `custom` to prevent
 * them from overriding system fields during evaluation.
 */
export interface Parcel {
  weight: number;
  value: number;
  destinationCountry: string;
  recipient: Recipient;
  custom: Record<string, unknown>;
}

/** Possible statuses after rule evaluation. */
export type RuleEngineStatus = 'ROUTED' | 'PENDING_APPROVAL' | 'UNROUTED';

/** Result of evaluating a parcel against routing rules. */
export interface RuleEngineResult {
  department: string | null;
  matchedRuleId: string | null;
  matchedRuleVersion: number | null;
  reason: string;
  requiresApproval: string | null;
  status: RuleEngineStatus;
}
