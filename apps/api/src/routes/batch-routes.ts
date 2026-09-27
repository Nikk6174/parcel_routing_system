import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  PARCEL_STATUS,
  parcelInputSchema,
  type ParcelDocument,
} from '@parcel-routing/shared';
import type { ParcelRepository } from '../db/parcel-repository.js';
import type { IdempotencyRepository } from '../db/idempotency-repository.js';
import { parseXmlStream, type ParsedRow } from '../parsers/xml-stream-parser.js';
import { parseJsonStream } from '../parsers/json-stream-parser.js';

interface BatchRouteOpts {
  parcelRepo: ParcelRepository;
  idempotencyRepo: IdempotencyRepository;
}

/**
 * Register batch parcel routes:
 * - POST /parcels/batch — multipart file upload (JSON or XML)
 * - GET  /parcels/batch/:batchId/status — aggregate counts per status
 */
export async function batchRoutes(
  app: FastifyInstance,
  opts: BatchRouteOpts,
): Promise<void> {
  const { parcelRepo, idempotencyRepo } = opts;

  // ── POST /parcels/batch ───────────────────────────────
  app.post('/parcels/batch', async (request, reply) => {
    // Idempotency check
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey === 'string') {
      const existing = await idempotencyRepo.find(idempotencyKey);
      if (existing) {
        await reply.status(existing.statusCode).send(existing.response);
        return;
      }
    }

    // Read the uploaded file
    const data = await request.file();
    if (!data) {
      await reply.status(400).send({
        status: 'error',
        error: 'No file uploaded. Send a multipart form with a file field.',
      });
      return;
    }

    const filename = data.filename ?? '';
    const mimetype = data.mimetype ?? '';
    const isXml =
      filename.endsWith('.xml') ||
      mimetype === 'application/xml' ||
      mimetype === 'text/xml';
    const isJson =
      filename.endsWith('.json') || mimetype === 'application/json';

    if (!isXml && !isJson) {
      await reply.status(400).send({
        status: 'error',
        error: `Unsupported file format "${filename}". Upload a .json or .xml file.`,
      });
      return;
    }

    const batchId = randomUUID();
    const log = request.log.child({ batchId });
    log.info({ filename, mimetype }, 'Processing batch upload');

    const accepted: Array<Omit<ParcelDocument, '_id'>> = [];
    const rejected: Array<{ rowIndex: number; reason: string }> = [];

    const handleRow = (row: ParsedRow): void => {
      if (row.ok) {
        accepted.push({
          weight: row.data.weight,
          value: row.data.value,
          destinationCountry: row.data.destinationCountry,
          recipient: row.data.recipient,
          custom: row.data.custom ?? {},
          status: PARCEL_STATUS.RECEIVED,
          batchId,
          correlationId: randomUUID(),
          retryCount: 0,
          claimedBy: null,
          claimedAt: null,
          sourceFormat: isXml ? 'xml' : 'json',
          createdAt: new Date(),
        });
      } else {
        rejected.push({ rowIndex: row.rowIndex, reason: row.reason });
      }
    };

    try {
      if (isXml) {
        await parseXmlStream(data.file, handleRow);
      } else {
        await parseJsonStream(data.file, handleRow);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, 'Batch parse failed');
      await reply.status(400).send({
        status: 'error',
        error: message,
      });
      return;
    }

    // Insert accepted parcels in bulk
    if (accepted.length > 0) {
      await parcelRepo.insertMany(accepted);
    }

    log.info(
      { accepted: accepted.length, rejected: rejected.length },
      'Batch upload complete',
    );

    const response = {
      status: 'ok' as const,
      data: {
        batchId,
        totalRows: accepted.length + rejected.length,
        acceptedRows: accepted.length,
        rejectedRows: rejected.length,
        ...(rejected.length > 0 ? { rejectedDetails: rejected } : {}),
      },
    };

    if (typeof idempotencyKey === 'string') {
      await idempotencyRepo.save(idempotencyKey, 202, response);
    }

    await reply.status(202).send(response);
  });

  // ── GET /parcels/batch/:batchId/status ────────────────
  app.get<{ Params: { batchId: string } }>(
    '/parcels/batch/:batchId/status',
    async (request, reply) => {
      const { batchId } = request.params;
      const counts = await parcelRepo.countByStatusForBatch(batchId);

      if (Object.keys(counts).length === 0) {
        await reply.status(404).send({
          status: 'error',
          error: `No parcels found for batch: ${batchId}`,
        });
        return;
      }

      await reply.status(200).send({
        status: 'ok',
        data: { batchId, counts },
      });
    },
  );
}
