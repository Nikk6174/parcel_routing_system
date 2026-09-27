import type { FastifyInstance } from 'fastify';
import { PARCEL_STATUS, type ParcelStatus } from '@parcel-routing/shared';
import { authorize } from '../security/index.js';
import type { ParcelRepository } from '../db/parcel-repository.js';

interface ApprovalRouteOpts {
  parcelRepo: ParcelRepository;
}

/**
 * Register approval routes:
 * - POST /parcels/:parcelId/approve — flip PENDING_APPROVAL → APPROVED
 * - POST /parcels/:parcelId/reject  — flip PENDING_APPROVAL → REJECTED
 */
export async function approvalRoutes(
  app: FastifyInstance,
  opts: ApprovalRouteOpts,
): Promise<void> {
  const { parcelRepo } = opts;

  async function handleApprovalAction(
    parcelId: string,
    targetStatus: ParcelStatus,
    parcelRepo: ParcelRepository,
  ): Promise<
    | { ok: true; parcelId: string; status: ParcelStatus }
    | { ok: false; statusCode: number; error: string }
  > {
    const parcel = await parcelRepo.findById(parcelId);
    if (!parcel) {
      return { ok: false, statusCode: 404, error: `Parcel not found: ${parcelId}` };
    }

    if (parcel.status !== PARCEL_STATUS.PENDING_APPROVAL) {
      return {
        ok: false,
        statusCode: 409,
        error: `Parcel status is "${parcel.status}", expected "PENDING_APPROVAL"`,
      };
    }

    await parcelRepo.updateStatus(parcelId, targetStatus);
    return { ok: true, parcelId, status: targetStatus };
  }

  // ── POST /parcels/:parcelId/approve ───────────────────
  app.post<{ Params: { parcelId: string } }>(
    '/parcels/:parcelId/approve',
    { preHandler: [authorize('insurance_approver')] },
    async (request, reply) => {
      const result = await handleApprovalAction(
        request.params.parcelId,
        PARCEL_STATUS.APPROVED,
        parcelRepo,
      );

      if (!result.ok) {
        await reply.status(result.statusCode).send({
          status: 'error',
          error: result.error,
        });
        return;
      }

      request.log.info(
        { parcelId: result.parcelId },
        'Parcel approved',
      );
      await reply.status(200).send({
        status: 'ok',
        data: { parcelId: result.parcelId, status: result.status },
      });
    },
  );

  // ── POST /parcels/:parcelId/reject ────────────────────
  app.post<{ Params: { parcelId: string } }>(
    '/parcels/:parcelId/reject',
    { preHandler: [authorize('insurance_approver')] },
    async (request, reply) => {
      const result = await handleApprovalAction(
        request.params.parcelId,
        PARCEL_STATUS.REJECTED,
        parcelRepo,
      );

      if (!result.ok) {
        await reply.status(result.statusCode).send({
          status: 'error',
          error: result.error,
        });
        return;
      }

      request.log.info(
        { parcelId: result.parcelId },
        'Parcel rejected',
      );
      await reply.status(200).send({
        status: 'ok',
        data: { parcelId: result.parcelId, status: result.status },
      });
    },
  );
}
