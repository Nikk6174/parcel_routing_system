import { SaxesParser } from 'saxes';
import type { Readable } from 'node:stream';
import type { ParcelInput } from '@parcel-routing/shared';

/**
 * Raw XML field values extracted from a <Parcel> element.
 * All values are strings — type coercion happens in mapXmlRowToParcel().
 */
interface RawXmlParcel {
  weight?: string;
  value?: string;
  recipientName?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
}

/**
 * Result of mapping a single XML row.
 * Either a valid parcel or an error reason.
 */
export type ParsedRow =
  | { ok: true; data: ParcelInput }
  | { ok: false; reason: string; rowIndex: number };

/**
 * Map a raw XML row into the internal ParcelInput shape.
 *
 * TYPE COERCION: Weight/Value arrive as text nodes ("0.02", "11", etc.).
 * Explicit parseFloat with NaN check — reject the row, not the whole batch.
 *
 * COUNTRY DEFAULT: XML sample has no country field. Set "NL" and record
 * custom._assumedCountry: true so it's traceable.
 */
function mapXmlRowToParcel(
  raw: RawXmlParcel,
  rowIndex: number,
): ParsedRow {
  const weight = parseFloat(raw.weight ?? '');
  if (Number.isNaN(weight)) {
    return {
      ok: false,
      reason: `Invalid weight "${raw.weight ?? ''}" — must be a number`,
      rowIndex,
    };
  }

  const value = parseFloat(raw.value ?? '');
  if (Number.isNaN(value)) {
    return {
      ok: false,
      reason: `Invalid value "${raw.value ?? ''}" — must be a number`,
      rowIndex,
    };
  }

  if (!raw.recipientName) {
    return { ok: false, reason: 'Missing recipient name', rowIndex };
  }
  if (!raw.street || !raw.houseNumber || !raw.postalCode || !raw.city) {
    return { ok: false, reason: 'Incomplete address fields', rowIndex };
  }

  return {
    ok: true,
    data: {
      weight,
      value,
      destinationCountry: 'NL',
      recipient: {
        name: raw.recipientName,
        address: {
          street: raw.street,
          houseNumber: raw.houseNumber,
          postalCode: raw.postalCode,
          city: raw.city,
        },
      },
      custom: { _assumedCountry: true },
    },
  };
}

/** Check if the current SAX path matches the expected path. */
function pathMatches(path: string[], expected: string[]): boolean {
  if (path.length !== expected.length) return false;
  for (let i = 0; i < path.length; i++) {
    if (path[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Stream-parse an XML file in `<Container><parcels><Parcel>...` format.
 *
 * Uses SAX (saxes) for true streaming — processes XML chunks as they arrive
 * from the upload stream. Never buffers the whole file into memory.
 *
 * @param stream  The upload file stream.
 * @param onRow   Callback for each parsed+mapped row (valid or invalid).
 * @returns       Promise that resolves when parsing is complete.
 */
export function parseXmlStream(
  stream: Readable,
  onRow: (row: ParsedRow) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sax = new SaxesParser();
    const path: string[] = [];
    let currentText = '';
    let currentParcel: RawXmlParcel | null = null;
    let rowIndex = 0;

    sax.on('opentag', (node) => {
      path.push(node.name);
      currentText = '';

      if (pathMatches(path, ['Container', 'parcels', 'Parcel'])) {
        currentParcel = {};
      }
    });

    sax.on('text', (text) => {
      currentText += text;
    });

    sax.on('closetag', () => {
      const text = currentText.trim();

      if (currentParcel) {
        if (pathMatches(path, ['Container', 'parcels', 'Parcel', 'Weight'])) {
          currentParcel.weight = text;
        } else if (pathMatches(path, ['Container', 'parcels', 'Parcel', 'Value'])) {
          currentParcel.value = text;
        } else if (
          pathMatches(path, ['Container', 'parcels', 'Parcel', 'Receipient', 'Name'])
        ) {
          currentParcel.recipientName = text;
        } else if (
          pathMatches(path, [
            'Container', 'parcels', 'Parcel', 'Receipient', 'Address', 'Street',
          ])
        ) {
          currentParcel.street = text;
        } else if (
          pathMatches(path, [
            'Container', 'parcels', 'Parcel', 'Receipient', 'Address', 'HouseNumber',
          ])
        ) {
          currentParcel.houseNumber = text;
        } else if (
          pathMatches(path, [
            'Container', 'parcels', 'Parcel', 'Receipient', 'Address', 'PostalCode',
          ])
        ) {
          currentParcel.postalCode = text;
        } else if (
          pathMatches(path, [
            'Container', 'parcels', 'Parcel', 'Receipient', 'Address', 'City',
          ])
        ) {
          currentParcel.city = text;
        }
      }

      if (pathMatches(path, ['Container', 'parcels', 'Parcel'])) {
        if (currentParcel) {
          onRow(mapXmlRowToParcel(currentParcel, rowIndex));
          rowIndex++;
          currentParcel = null;
        }
      }

      path.pop();
      currentText = '';
    });

    sax.on('error', (err) => {
      reject(new Error(`XML parse error: ${err.message}`));
    });

    stream.on('data', (chunk: Buffer) => {
      try {
        sax.write(chunk.toString('utf-8'));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`XML parse error: ${msg}`));
      }
    });

    stream.on('end', () => {
      try {
        sax.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`XML parse error at end: ${msg}`));
      }
      resolve();
    });

    stream.on('error', (err) => {
      reject(new Error(`Stream error: ${err.message}`));
    });
  });
}
