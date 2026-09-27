import type { Parcel } from './types.js';
import { FieldResolutionError } from './errors.js';

/**
 * Known system-level top-level fields on a Parcel.
 *
 * Any condition field path whose first segment is NOT in this set and is NOT
 * "custom" is rejected. This prevents a custom attribute from ever being
 * confused with a system field during evaluation.
 */
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  'weight',
  'value',
  'destinationCountry',
  'recipient',
]);

/**
 * Resolve a dot-separated field path against a parcel.
 *
 * - System fields (`weight`, `value`, `destinationCountry`, `recipient.*`)
 *   resolve from the parcel root.
 * - Custom fields must be prefixed with `custom.` and resolve from `parcel.custom`.
 * - Any other top-level key is rejected with a FieldResolutionError.
 *
 * @param parcel    The parcel to resolve against.
 * @param fieldPath Dot-separated path, e.g. "weight", "recipient.address.city",
 *                  "custom.fragile".
 * @returns The resolved value, or `undefined` if the path is valid but the
 *          value is absent.
 * @throws FieldResolutionError if the path is invalid.
 */
export function resolveField(parcel: Parcel, fieldPath: string): unknown {
  if (!fieldPath) {
    throw new FieldResolutionError(fieldPath, 'Field path cannot be empty');
  }

  const segments = fieldPath.split('.');
  const topLevel = segments[0];

  if (!topLevel) {
    throw new FieldResolutionError(fieldPath, 'Field path cannot be empty');
  }

  // ── Custom namespace ──────────────────────────────────
  if (topLevel === 'custom') {
    if (segments.length < 2) {
      throw new FieldResolutionError(
        fieldPath,
        'Field "custom" requires a sub-key (e.g. "custom.fragile")',
      );
    }
    return traverseFrom(parcel.custom, segments, 1);
  }

  // ── System fields ─────────────────────────────────────
  if (!KNOWN_TOP_LEVEL_FIELDS.has(topLevel)) {
    throw new FieldResolutionError(
      fieldPath,
      `Unknown top-level field "${topLevel}". ` +
        `Only system fields (${[...KNOWN_TOP_LEVEL_FIELDS].join(', ')}) ` +
        `and "custom.*" are allowed.`,
    );
  }

  // Build a plain record of system fields for safe traversal.
  // custom is intentionally excluded so it can never shadow system fields.
  const systemView: Record<string, unknown> = {
    weight: parcel.weight,
    value: parcel.value,
    destinationCountry: parcel.destinationCountry,
    recipient: parcel.recipient,
  };

  return traverseFrom(systemView, segments, 0);
}

/**
 * Walk a dot-path through a nested object starting at a given segment index.
 * Returns `undefined` if any intermediate segment is null/undefined/non-object.
 */
function traverseFrom(
  root: Record<string, unknown>,
  segments: string[],
  startIndex: number,
): unknown {
  let current: unknown = root;

  for (let i = startIndex; i < segments.length; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    const segment = segments[i];
    if (!segment) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
