import type { Rule, Parcel, RuleEngineResult, Condition } from './types.js';
import type { RuleMatcher } from './rule-matcher.js';
import { RuleConflictError } from './errors.js';
import { resolveField } from './field-resolver.js';
import { getOperator } from './operators.js';

/**
 * Orchestrates rule evaluation for a parcel.
 *
 * Takes a parcel and an array of active rules (already sorted/filtered
 * externally — the engine does NOT fetch rules itself).
 *
 * Evaluation order:
 * 1. Separate precondition_rules from condition_rules.
 * 2. Evaluate preconditions first (highest priority wins).
 * 3. Evaluate condition_rules (highest priority wins).
 * 4. Combine into a single RuleEngineResult.
 *
 * Priority model: lower priority number = higher precedence.
 * Rules are grouped by priority and evaluated group by group.
 * Within a group, if two or more rules both match, a RuleConflictError is thrown.
 */
export class RuleEngine {
  constructor(private readonly matcher: RuleMatcher) {}

  /**
   * Evaluate a parcel against a set of active rules.
   *
   * @param parcel The parcel to route.
   * @param rules  Active rules to evaluate.
   * @returns A result describing the routing decision.
   * @throws RuleConflictError if two rules at the same priority both match.
   */
  evaluate(parcel: Parcel, rules: Rule[]): RuleEngineResult {
    const preconditions = rules.filter((r) => r.type === 'precondition_rule');
    const conditionRules = rules.filter((r) => r.type === 'condition_rule');

    const matchedPrecondition = this.findWinningRule(preconditions, parcel);
    const matchedConditionRule = this.findWinningRule(conditionRules, parcel);

    return this.buildResult(parcel, matchedConditionRule, matchedPrecondition);
  }

  /**
   * Find the single winning rule from a list, respecting priority grouping.
   *
   * For each priority level (lowest number first = highest precedence):
   * - If exactly one rule matches → it wins; stop.
   * - If two or more match → RuleConflictError.
   * - If none match → continue to the next priority level.
   */
  private findWinningRule(rules: Rule[], parcel: Parcel): Rule | null {
    const groups = groupByPriority(rules);
    const priorities = [...groups.keys()].sort((a, b) => a - b);

    for (const priority of priorities) {
      const rulesAtPriority = groups.get(priority);
      if (!rulesAtPriority) continue;

      const matches = rulesAtPriority.filter((r) => this.matcher.match(r, parcel));

      if (matches.length > 1) {
        const first = matches[0];
        const second = matches[1];
        if (first && second) {
          throw new RuleConflictError(first._id, second._id, priority);
        }
      }

      if (matches.length === 1) {
        const winner = matches[0];
        if (winner) return winner;
      }
    }

    return null;
  }

  /**
   * Combine the matched condition rule and precondition into a final result.
   *
   * Status logic:
   * - No condition_rule matched → UNROUTED (regardless of preconditions)
   * - Condition_rule matched + precondition with block_until_approved → PENDING_APPROVAL
   * - Condition_rule matched + no blocking precondition → ROUTED
   */
  private buildResult(
    parcel: Parcel,
    conditionRule: Rule | null,
    precondition: Rule | null,
  ): RuleEngineResult {
    const requiresApproval = precondition?.action.require_approval ?? null;
    const blockUntilApproved = precondition?.action.block_until_approved ?? false;

    if (!conditionRule) {
      return {
        department: null,
        matchedRuleId: null,
        matchedRuleVersion: null,
        reason: 'No routing rule matched',
        requiresApproval: null,
        status: 'UNROUTED',
      };
    }

    const reason = generateMatchReason(conditionRule, parcel);
    const status = precondition && blockUntilApproved ? 'PENDING_APPROVAL' : 'ROUTED';

    return {
      department: conditionRule.action.route_to ?? null,
      matchedRuleId: conditionRule._id,
      matchedRuleVersion: conditionRule.version,
      reason,
      requiresApproval,
      status,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────

function groupByPriority(rules: Rule[]): Map<number, Rule[]> {
  const groups = new Map<number, Rule[]>();
  for (const rule of rules) {
    const existing = groups.get(rule.priority);
    if (existing) {
      existing.push(rule);
    } else {
      groups.set(rule.priority, [rule]);
    }
  }
  return groups;
}

/**
 * Generate a human-readable reason describing why a rule matched.
 * Inspects the rule's conditions and the parcel's actual field values.
 */
function generateMatchReason(rule: Rule, parcel: Parcel): string {
  const parts: string[] = [];

  if (rule.conditions.all) {
    for (const c of rule.conditions.all) {
      parts.push(formatCondition(c, parcel));
    }
  }

  if (rule.conditions.any) {
    // Show only the any-conditions that actually matched
    const matchedAny = rule.conditions.any.filter((c) => {
      const val = resolveField(parcel, c.field);
      const op = getOperator(c.operator);
      return op(val, c.value);
    });
    for (const c of matchedAny) {
      parts.push(formatCondition(c, parcel));
    }
  }

  const conditionsText =
    parts.length > 0 ? parts.join('; ') : 'no conditions (always matches)';
  return `Matched rule "${rule.name}": ${conditionsText}`;
}

function formatCondition(condition: Condition, parcel: Parcel): string {
  const actual = resolveField(parcel, condition.field);
  const formattedActual = formatValue(actual);

  if (condition.operator === 'in' || condition.operator === 'not_in') {
    const arr = Array.isArray(condition.value) ? condition.value : [condition.value];
    const formattedArr = arr.map(formatValue).join(', ');
    return `${condition.field} ${formattedActual} ${condition.operator} [${formattedArr}]`;
  }

  return `${condition.field} ${formattedActual} ${condition.operator} ${formatValue(condition.value)}`;
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return `"${val}"`;
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  return String(val);
}
