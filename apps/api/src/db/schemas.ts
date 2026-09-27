import { z } from 'zod';

/**
 * Zod schema for a single rule condition.
 * Matches Phase 2's Condition interface exactly.
 */
const conditionSchema = z.object({
  field: z.string().min(1, 'Condition field is required'),
  operator: z.enum(['eq', 'neq', '>', '>=', '<', '<=', 'in', 'not_in']),
  value: z.unknown().refine(
    (val) => val !== undefined,
    'Condition value cannot be undefined',
  ),
}).strict();

/**
 * Zod schema for a rule's action block.
 */
const ruleActionSchema = z.object({
  route_to: z.string().min(1).optional(),
  require_approval: z.string().min(1).optional(),
  block_until_approved: z.boolean().optional(),
}).strict();

/**
 * Zod schema for creating a new routing rule.
 *
 * Fields NOT included here (managed by the repository):
 * - _id: auto-generated
 * - version: starts at 1, auto-incremented on update
 * - active: defaults to true
 * - createdAt: set to current time
 */
export const createRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  priority: z.number().int().min(1, 'Priority must be a positive integer'),
  type: z.enum(['condition_rule', 'precondition_rule']),
  conditions: z.object({
    all: z.array(conditionSchema).optional(),
    any: z.array(conditionSchema).optional(),
  }).strict(),
  action: ruleActionSchema,
  createdBy: z.string().min(1, 'createdBy is required'),
}).strict();

/** Input type for creating a rule (inferred from Zod schema). */
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
