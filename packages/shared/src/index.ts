/**
 * Shared types and schemas for the Parcel Routing System.
 */

/** Application-wide status codes for API responses. */
export type ApiStatus = 'ok' | 'error';

/** Standard API response envelope used by all endpoints. */
export interface ApiResponse<T> {
  status: ApiStatus;
  data?: T;
  error?: string;
}

// Phase 2: Rule engine
export * from './rule-engine/index.js';

// Phase 3: Shared types (ParcelStatus, document interfaces)
export * from './types/index.js';

// Phase 5: Validation schemas
export * from './schemas/index.js';


