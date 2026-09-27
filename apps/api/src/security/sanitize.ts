/**
 * Input sanitization utility.
 *
 * Applied to free-text fields before storage to prevent stored XSS
 * if values are ever rendered in a context that doesn't auto-escape
 * (email templates, PDF exports, external integrations).
 *
 * The primary XSS boundary is output encoding (React's JSX escaping),
 * but defense-in-depth means we also sanitize on the way IN.
 */

/**
 * Strip HTML tags and trim whitespace from a string value.
 *
 * @param input The raw string to sanitize.
 * @returns The sanitized string with HTML tags removed.
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/&lt;/gi, '<')   // Decode common entities that might bypass
    .replace(/<[^>]*>/g, '') // Re-strip after entity decode
    .trim();
}

/**
 * Recursively sanitize all string values in a Record (custom attributes).
 *
 * Both keys AND values are sanitized — a malicious key like
 * `<script>alert(1)</script>` is just as dangerous as a malicious value.
 *
 * @param record The key-value pairs to sanitize.
 * @returns A new record with all string keys and values sanitized.
 */
export function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const cleanKey = sanitizeString(key);

    if (typeof value === 'string') {
      result[cleanKey] = sanitizeString(value);
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result[cleanKey] = sanitizeRecord(value as Record<string, unknown>);
    } else {
      // Numbers, booleans, arrays, null — pass through unchanged
      result[cleanKey] = value;
    }
  }

  return result;
}

/**
 * Sanitize a parcel input's free-text fields in-place.
 *
 * Applied to:
 * - recipient.name
 * - recipient.address.* (street, city, etc.)
 * - custom attribute keys and values
 *
 * NOT applied to:
 * - weight, value (numbers — no XSS risk)
 * - destinationCountry (validated against format, not free-text)
 */
export function sanitizeParcelInput<T extends {
  recipient: {
    name: string;
    address: {
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
    };
  };
  custom?: Record<string, unknown>;
}>(input: T): T {
  return {
    ...input,
    recipient: {
      ...input.recipient,
      name: sanitizeString(input.recipient.name),
      address: {
        street: sanitizeString(input.recipient.address.street),
        houseNumber: sanitizeString(input.recipient.address.houseNumber),
        postalCode: sanitizeString(input.recipient.address.postalCode),
        city: sanitizeString(input.recipient.address.city),
      },
    },
    custom: input.custom ? sanitizeRecord(input.custom) : {},
  };
}
