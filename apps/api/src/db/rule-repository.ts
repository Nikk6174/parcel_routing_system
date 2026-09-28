import { type Collection, type Db, ObjectId } from 'mongodb';
import type { RuleDocument } from '@parcel-routing/shared';
import { createRuleSchema, type CreateRuleInput } from './schemas.js';

/**
 * Priority conflict error — thrown when an active rule with the same priority
 * already exists.
 */
export class PriorityConflictError extends Error {
  public readonly conflictingRuleId: string;
  public readonly conflictingRuleName: string;
  public readonly priority: number;

  constructor(conflicting: RuleDocument, priority: number) {
    super(
      `Active rule "${conflicting.name}" (id: ${conflicting._id}) already has ` +
        `priority ${String(priority)}. No two active rules may share the same priority.`,
    );
    this.name = 'PriorityConflictError';
    this.conflictingRuleId = conflicting._id;
    this.conflictingRuleName = conflicting.name;
    this.priority = priority;
  }
}

/**
 * Repository for the `routing_rules` collection.
 *
 * Key invariants:
 * - Every write is a NEW VERSION — conditions are never mutated in-place.
 * - `active: false` is how a rule is "deleted" — never hard-delete.
 * - No two ACTIVE rules may share the same priority.
 */
export class RuleRepository {
  private readonly collection: Collection<RuleDocument>;

  constructor(db: Db) {
    this.collection = db.collection<RuleDocument>('routing_rules');
  }

  /**
   * Create a new routing rule (version 1, active).
   *
   * If an active rule already occupies the requested priority, all active
   * rules at that priority and below (higher numbers) are shifted down by 1
   * so the new rule can slot in. Rules above (lower numbers) are untouched.
   *
   * @throws ZodError if the input is invalid.
   */
  async create(input: CreateRuleInput): Promise<RuleDocument> {
    const parsed = createRuleSchema.parse(input);

    // Shift existing rules down if the requested priority is already taken
    await this.shiftPrioritiesDown(parsed.priority);

    const doc: RuleDocument = {
      _id: new ObjectId().toHexString(),
      name: parsed.name,
      version: 1,
      active: true,
      priority: parsed.priority,
      type: parsed.type,
      conditions: parsed.conditions,
      action: parsed.action,
      createdAt: new Date(),
      createdBy: parsed.createdBy,
    };

    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Shift active rules at `startPriority` and below (higher numbers) down
   * by 1 to make room for a new rule.
   *
   * Updates are performed one-by-one from the HIGHEST priority number
   * downward so the unique partial index on { priority, active: true }
   * is never violated mid-shift.
   *
   * If no active rule occupies `startPriority`, this is a no-op.
   */
  private async shiftPrioritiesDown(startPriority: number): Promise<void> {
    // Find all active rules at or below the requested priority (sorted descending)
    const toShift = await this.collection
      .find({ active: true, priority: { $gte: startPriority } })
      .sort({ priority: -1 })
      .toArray();

    if (toShift.length === 0) return;

    // Only shift if the exact startPriority is occupied
    const isOccupied = toShift.some((r) => r.priority === startPriority);
    if (!isOccupied) return;

    // Update one-by-one from highest to lowest to avoid unique index collision
    for (const rule of toShift) {
      await this.collection.updateOne(
        { _id: rule._id },
        { $set: { priority: rule.priority + 1 } },
      );
    }
  }

  /**
   * Update a rule by deactivating the current version and inserting a new one.
   *
   * The old version remains in the DB with `active: false` for audit history.
   * The new version gets `version: old + 1` and a new `_id`.
   *
   * @throws Error if the rule is not found.
   * @throws ZodError if the input is invalid.
   * @throws PriorityConflictError if priority conflicts with another active rule.
   */
  async update(
    ruleId: string,
    input: CreateRuleInput,
  ): Promise<RuleDocument> {
    const existing = await this.collection.findOne({ _id: ruleId });
    if (!existing) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const parsed = createRuleSchema.parse(input);

    await this.assertUniquePriority(parsed.priority, ruleId);

    // Deactivate old version — never mutate its conditions
    await this.collection.updateOne(
      { _id: ruleId },
      { $set: { active: false } },
    );

    // Insert new version
    const newDoc: RuleDocument = {
      _id: new ObjectId().toHexString(),
      name: parsed.name,
      version: existing.version + 1,
      active: true,
      priority: parsed.priority,
      type: parsed.type,
      conditions: parsed.conditions,
      action: parsed.action,
      createdAt: new Date(),
      createdBy: parsed.createdBy,
    };

    await this.collection.insertOne(newDoc);
    return newDoc;
  }

  /**
   * Soft-delete: set a rule to inactive.
   * @returns true if the rule was active and is now deactivated.
   */
  async deactivate(ruleId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: ruleId, active: true },
      { $set: { active: false } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Find all active rules, sorted by priority (ascending = highest first).
   */
  async findActive(): Promise<RuleDocument[]> {
    return this.collection
      .find({ active: true })
      .sort({ priority: 1 })
      .toArray();
  }

  /**
   * Find a specific rule by _id (any version, active or not).
   */
  async findById(id: string): Promise<RuleDocument | null> {
    return this.collection.findOne({ _id: id });
  }

  /**
   * Check that no other active rule has the given priority.
   * @param excludeRuleId Rule to exclude from the check (for updates).
   */
  private async assertUniquePriority(
    priority: number,
    excludeRuleId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      active: true,
      priority,
    };
    if (excludeRuleId) {
      filter['_id'] = { $ne: excludeRuleId };
    }

    const conflicting = await this.collection.findOne(
      filter as Parameters<typeof this.collection.findOne>[0],
    );

    if (conflicting) {
      throw new PriorityConflictError(conflicting, priority);
    }
  }
}
