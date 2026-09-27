import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  PARCEL_STATUS,
  parcelInputSchema,
  type ParcelDocument,
} from '@parcel-routing/shared';
import type { ParcelRepository } from '../db/parcel-repository.js';
import type { OutcomeRepository } from '../db/outcome-repository.js';
import type { IdempotencyRepository } from '../db/idempotency-repository.js';
import { authorize, sanitizeParcelInput } from '../security/index.js';

interface ParcelRouteOpts {
  parcelRepo: ParcelRepository;
  outcomeRepo: OutcomeRepository;
  idempotencyRepo: IdempotencyRepository;
}

/**
 * Register single-parcel routes:
 * - POST /parcels — submit a single parcel
 * - GET  /parcels/:parcelId — get parcel status + outcome
 */
export async function parcelRoutes(
  app: FastifyInstance,
  opts: ParcelRouteOpts,
): Promise<void> {
  const { parcelRepo, outcomeRepo, idempotencyRepo } = opts;

  // ── POST /parcels ─────────────────────────────────────
  app.post('/parcels', { preHandler: [authorize('operator')] }, async (request, reply) => {
    // Idempotency check
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey === 'string') {
      const existing = await idempotencyRepo.find(idempotencyKey);
      if (existing) {
        await reply.status(existing.statusCode).send(existing.response);
        return;
      }
    }

    // Validate body
    const parseResult = parcelInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      await reply.status(400).send({ status: 'error', errors });
      return;
    }

    const input = sanitizeParcelInput(parseResult.data);
    const correlationId = randomUUID();

    // Attach correlationId to request-scoped logger.
    // All subsequent req.log calls in this request include it.
    const log = request.log.child({ correlationId });

    log.info('Submitting parcel');

    const parcelDoc: Omit<ParcelDocument, '_id'> = {
      weight: input.weight,
      value: input.value,
      destinationCountry: input.destinationCountry,
      recipient: input.recipient,
      custom: input.custom ?? {},
      status: PARCEL_STATUS.RECEIVED,
      batchId: null,
      correlationId,
      retryCount: 0,
      claimedBy: null,
      claimedAt: null,
      sourceFormat: 'json',
      createdAt: new Date(),
    };

    const parcel = await parcelRepo.insertOne(parcelDoc);

    log.info({ parcelId: parcel._id }, 'Parcel submitted');

    const response = {
      status: 'ok' as const,
      data: { parcelId: parcel._id, correlationId },
    };

    // Save idempotency result
    if (typeof idempotencyKey === 'string') {
      await idempotencyRepo.save(idempotencyKey, 202, response);
    }

    await reply.status(202).send(response);
  });

  // ── GET /parcels (paginated list) ─────────────────────
  app.get<{
    Querystring: { page?: string; limit?: string; status?: string; batchId?: string };
  }>('/parcels', async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10) || 20));
    const status = request.query.status || undefined;
    const batchId = request.query.batchId || undefined;

    const result = await parcelRepo.findPaginated({ page, limit, status, batchId });

    await reply.status(200).send({
      status: 'ok',
      data: {
        parcels: result.parcels,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });

  // ── GET /parcels/:parcelId ────────────────────────────
  app.get<{ Params: { parcelId: string } }>(
    '/parcels/:parcelId',
    async (request, reply) => {
      const { parcelId } = request.params;
      const parcel = await parcelRepo.findById(parcelId);

      if (!parcel) {
        await reply.status(404).send({
          status: 'error',
          error: `Parcel not found: ${parcelId}`,
        });
        return;
      }

      const outcome = await outcomeRepo.findByParcelId(parcelId);

      await reply.status(200).send({
        status: 'ok',
        data: { parcel, outcome: outcome ?? undefined },
      });
    },
  );
}
