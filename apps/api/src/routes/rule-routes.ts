import type { FastifyInstance } from 'fastify';
import { authorize } from '../security/index.js';
import {
  createRuleSchema,
  RuleRepository,
  PriorityConflictError,
} from '../db/index.js';

interface RuleRouteOpts {
  ruleRepo: RuleRepository;
  /**
   * Called after a rule is created or updated.
   * The API server uses this to invalidate the orchestrator's in-memory
   * rule cache so new/updated rules take effect immediately.
   * Optional — tests can omit it.
   */
  onRuleChange?: () => void;
}

/**
 * Register rule admin routes:
 * - POST /rules    — create a new routing rule
 * - PUT  /rules/:id — update an existing rule (new version)
 */
export async function ruleRoutes(
  app: FastifyInstance,
  opts: RuleRouteOpts,
): Promise<void> {
  const { ruleRepo, onRuleChange } = opts;

  // ── POST /rules ───────────────────────────────────────
  app.post(
    '/rules',
    { preHandler: [authorize('admin')] },
    async (request, reply) => {
      const parseResult = createRuleSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        await reply.status(400).send({ status: 'error', errors });
        return;
      }

      try {
        const rule = await ruleRepo.create(parseResult.data);
        request.log.info({ ruleId: rule._id }, 'Rule created');
        onRuleChange?.();
        await reply.status(201).send({ status: 'ok', data: { rule } });
      } catch (err: unknown) {
        if (err instanceof PriorityConflictError) {
          await reply.status(409).send({
            status: 'error',
            error: err.message,
          });
          return;
        }
        throw err;
      }
    },
  );

  // ── PUT /rules/:id ───────────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/rules/:id',
    { preHandler: [authorize('admin')] },
    async (request, reply) => {
      const parseResult = createRuleSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        await reply.status(400).send({ status: 'error', errors });
        return;
      }

      try {
        const rule = await ruleRepo.update(request.params.id, parseResult.data);
        request.log.info({ ruleId: rule._id }, 'Rule updated');
        onRuleChange?.();
        await reply.status(200).send({ status: 'ok', data: { rule } });
      } catch (err: unknown) {
        if (err instanceof PriorityConflictError) {
          await reply.status(409).send({
            status: 'error',
            error: err.message,
          });
          return;
        }
        if (err instanceof Error && err.message.startsWith('Rule not found')) {
          await reply.status(404).send({
            status: 'error',
            error: err.message,
          });
          return;
        }
        throw err;
      }
    },
  );
}
