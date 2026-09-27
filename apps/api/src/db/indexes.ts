import type { Db } from 'mongodb';

/**
 * Create required indexes on all collections.
 * Idempotent — safe to call on every application startup.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  // ── parcels ───────────────────────────────────────────

  /**
   * Index: parcels.status + createdAt
   *
   * WHY: claimNext() filters by { status: "RECEIVED" } and sorts by
   * { createdAt: 1 } (oldest-first FIFO). Without this compound index,
   * every claim attempt would require a full collection scan followed by
   * an in-memory sort. With the index, both filter and sort are covered.
   */
  await db.collection('parcels').createIndex(
    { status: 1, createdAt: 1 },
    { name: 'idx_parcels_status_createdAt' },
  );

  /**
   * Index: parcels.batchId
   *
   * WHY: Parcels ingested from the same source (e.g. one XML file) share
   * a batchId. Monitoring dashboards and debug queries frequently filter
   * by batchId to inspect a specific ingestion run. Without this index,
   * such queries would scan the entire collection.
   */
  await db.collection('parcels').createIndex(
    { batchId: 1 },
    { name: 'idx_parcels_batchId' },
  );

  // ── routing_rules ─────────────────────────────────────

  /**
   * Index: routing_rules.active + priority
   *
   * WHY: The rule loader queries { active: true } sorted by { priority: 1 }.
   * This compound index makes the query an index-only scan — no collection
   * access needed to satisfy the filter or sort.
   */
  await db.collection('routing_rules').createIndex(
    { active: 1, priority: 1 },
    { name: 'idx_rules_active_priority' },
  );

  /**
   * Unique partial index: no two ACTIVE rules may share the same priority.
   *
   * WHY: The rule engine throws RuleConflictError when two same-priority rules
   * match. This index prevents that situation from ever occurring by rejecting
   * writes that would create a duplicate active priority. The partialFilterExpression
   * ensures that deactivated (historical) rule versions are not constrained —
   * only currently active rules must have unique priorities.
   *
   * NOTE: The application-level check in RuleRepository provides a user-friendly
   * error message. This DB-level index is the atomic safety net that prevents
   * race conditions between concurrent writes.
   */
  await db.collection('routing_rules').createIndex(
    { priority: 1 },
    {
      name: 'idx_rules_unique_active_priority',
      unique: true,
      partialFilterExpression: { active: true },
    },
  );
}
