/**
 * XSS sanitization for user-entered text before rendering.
 *
 * React's JSX interpolation ({value}) already escapes HTML entities,
 * preventing XSS in most cases. This utility provides DEFENSE-IN-DEPTH:
 * it explicitly strips HTML tags from any user-entered string before
 * it reaches the React render tree.
 *
 * Use this on any value that originates from user input and is stored
 * in the database (e.g. custom attributes on parcels).
 */
export function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Strip HTML tags. React would escape them anyway, but this makes
  // the intent explicit and provides a safety net if anyone later
  // uses dangerouslySetInnerHTML or injects into attributes.
  return str.replace(/<[^>]*>/g, '');
}
