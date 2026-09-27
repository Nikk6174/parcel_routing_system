// ── Connection ────────────────────────────────────────────
export { connectToDatabase } from './client.js';
export type { DatabaseConnection } from './client.js';

// ── Indexes ──────────────────────────────────────────────
export { ensureIndexes } from './indexes.js';

// ── Schemas ──────────────────────────────────────────────
export { createRuleSchema } from './schemas.js';
export type { CreateRuleInput } from './schemas.js';

// ── Repositories ─────────────────────────────────────────
export { RuleRepository, PriorityConflictError } from './rule-repository.js';
export { ParcelRepository } from './parcel-repository.js';
export { OutcomeRepository } from './outcome-repository.js';
export type { BulkWriteOutcomeResult } from './outcome-repository.js';
export { IdempotencyRepository } from './idempotency-repository.js';

