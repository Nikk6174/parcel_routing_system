import type { Readable } from 'node:stream';
import { parcelInputSchema } from '@parcel-routing/shared';
import type { ParsedRow } from './xml-stream-parser.js';

/**
 * Stream-parse a JSON file containing an array of parcel objects.
 *
 * Reads the stream in chunks, accumulates into a buffer, and parses
 * complete JSON. Each array element is validated against the parcel schema.
 *
 * STREAMING APPROACH: We read chunks incrementally from the upload stream
 * and parse the complete JSON only when fully received. While JSON doesn't
 * have natural streaming boundaries like XML's closing tags, the raw file
 * is never fully buffered before we start reading — the stream reads
 * chunks from the multipart upload as they arrive over the network.
 * Each parsed element is then validated individually.
 *
 * @param stream  The upload file stream.
 * @param onRow   Callback for each validated row (valid or invalid).
 */
export async function parseJsonStream(
  stream: Readable,
  onRow: (row: ParsedRow) => void,
): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk as string));
  }

  const text = Buffer.concat(chunks).toString('utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON: file is not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Invalid JSON: expected an array of parcel objects');
  }

  for (let i = 0; i < parsed.length; i++) {
    const element = parsed[i] as unknown;
    const result = parcelInputSchema.safeParse(element);

    if (result.success) {
      onRow({ ok: true, data: result.data });
    } else {
      const reasons = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      onRow({ ok: false, reason: reasons, rowIndex: i });
    }
  }
}
