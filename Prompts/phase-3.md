# Phase 3 — MongoDB Data Layer

> **Status:** ✅ Complete
> **Depends on:** Phase 1 (config/build), Phase 2 (rule-engine types)
> **Next phase:** Phase 4

---

## What was implemented

Phase 3 adds the MongoDB persistence layer in `apps/api/src/db/` and shared
DB types in `packages/shared/src/types/`. It implements three repository classes
with full CRUD, atomic claim-based concurrency, and bulk write with partial
failure handling.

### Files created

| Location | File | Responsibility |
|----------|------|----------------|
| `packages/shared/src/types/` | `parcel-status.ts` | `PARCEL_STATUS` const + `ParcelStatus` type |
| | `documents.ts` | `RuleDocument`, `ParcelDocument`, `OutcomeDocument` interfaces |
| | `index.ts` | Barrel export |
| `apps/api/src/db/` | `client.ts` | `connectToDatabase()` factory |
| | `indexes.ts` | `ensureIndexes()` — creates all required indexes |
| | `schemas.ts` | Zod schema for rule validation |
| | `rule-repository.ts` | `RuleRepository` class |
| | `parcel-repository.ts` | `ParcelRepository` class |
| | `outcome-repository.ts` | `OutcomeRepository` class |
| | `index.ts` | Barrel export |
| | `*.test.ts` (×3) | Integration tests with mongodb-memory-server |

### Files modified (minimal)

| File | Change |
|------|--------|
| `packages/shared/src/index.ts` | Added `export * from './types/index.js'` |

### Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `rule-repository.test.ts` | 15 | CRUD, versioning, Zod validation, priority conflicts |
| `parcel-repository.test.ts` | 8 | Insert/claim, FIFO, concurrent atomicity, stale recovery |
| `outcome-repository.test.ts` | 5 | Bulk success, empty input, partial failure, findByParcelId |
| **Phase 3 total** | **28** | |
| **Cumulative total** | **113** | (Phase 1: 8, Phase 2: 77, Phase 3: 28) |

---

## How this connects with Phase 1 and Phase 2

```
Phase 1:                     Phase 2:                     Phase 3:

apps/api/src/               packages/shared/src/          packages/shared/src/
  config/env.ts               rule-engine/                  types/
  (MONGO_URI validated)         types.ts ──────────────►      documents.ts
                                (Rule, Parcel)                (RuleDocument extends Rule)
                                                              (ParcelDocument extends Parcel)
                                                              parcel-status.ts
                                                              (PARCEL_STATUS enum)
                                                            apps/api/src/
                                                              db/
                                                                rule-repository.ts
                                                                parcel-repository.ts
                                                                outcome-repository.ts
                                                                indexes.ts
                                                                schemas.ts (Zod)
                                                                client.ts
```

- **Phase 1's `MONGO_URI`** config feeds into Phase 3's `connectToDatabase(uri)`.
- **Phase 2's `Rule` and `Parcel` interfaces** are extended by `RuleDocument`
  and `ParcelDocument` — the engine types are the base, the DB types add
  persistence metadata.
- The rule engine remains pure — it still takes `Rule[]` and `Parcel` as
  arguments. The repository handles converting between DB documents and
  engine types.

---

## Execution flow

### Parcel claim lifecycle

```
1. Ingestion (future phase) inserts parcels:
   { status: RECEIVED, claimedBy: null }

2. Worker calls ParcelRepository.claimNext("worker-7"):
   findOneAndUpdate(
     filter: { status: "RECEIVED" },
     update: { $set: { status: "CLAIMED", claimedBy: "worker-7", claimedAt: now } },
     sort:   { createdAt: 1 },           ← FIFO ordering
     returnDocument: "after"
   )
   → MongoDB acquires document-level lock
   → Only ONE worker gets the document
   → Others get null

3. Worker processes parcel through Rule Engine (Phase 2)
   → Produces an OutcomeDocument

4. OutcomeRepository.bulkWriteOutcomes([outcome])
   → ordered: false ensures independence

5. If worker crashes before step 4:
   ParcelRepository.recoverStaleClaims(300_000)
   → Resets stale CLAIMED parcels back to RECEIVED
   → Increments retryCount
   → Another worker picks them up
```

### Rule versioning lifecycle

```
1. Admin creates rule:
   RuleRepository.create({ name: "Heavy", priority: 1, ... })
   → Zod validates input
   → Checks no active rule has priority 1
   → Inserts: { _id: "abc", version: 1, active: true, ... }

2. Admin updates rule:
   RuleRepository.update("abc", { name: "Heavy v2", priority: 1, ... })
   → Finds existing doc (version 1)
   → Validates new input
   → Sets { _id: "abc", active: false }     ← old version preserved
   → Inserts: { _id: "def", version: 2, active: true, ... }

3. Admin "deletes" rule:
   RuleRepository.deactivate("def")
   → Sets { _id: "def", active: false }
   → Rule never hard-deleted
```

### Module dependency flow

```
                    ┌──────────────────────┐
                    │ packages/shared/src/ │
                    │   types/             │
                    │     parcel-status.ts  │
                    │     documents.ts      │ ← extends rule-engine types
                    └──────────┬───────────┘
                               │ imported by
                               ▼
                    ┌──────────────────────┐
                    │ apps/api/src/db/     │
                    │   schemas.ts         │ ← Zod validation
                    │   rule-repository    │
                    │   parcel-repository  │
                    │   outcome-repository │
                    │   indexes.ts         │
                    │   client.ts          │
                    └──────────────────────┘
```

---

## Collections and indexes

### `routing_rules` collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | hex ObjectId, changes on version update |
| `name` | string | Human-readable rule name |
| `version` | number | Auto-incremented on update |
| `active` | boolean | `false` = soft-deleted / superseded |
| `priority` | number | Lower = higher precedence |
| `type` | `"condition_rule"` ∣ `"precondition_rule"` | |
| `conditions` | `{ all?, any? }` | Phase 2 shape |
| `action` | `{ route_to?, require_approval?, block_until_approved? }` | |
| `createdAt` | Date | |
| `createdBy` | string | |

**Indexes:**

| Index | Fields | Properties | Why |
|-------|--------|------------|-----|
| `idx_rules_active_priority` | `{ active: 1, priority: 1 }` | — | Query performance: `findActive()` filters by `active: true` and sorts by `priority`. Compound index covers both. |
| `idx_rules_unique_active_priority` | `{ priority: 1 }` | `unique: true`, `partialFilterExpression: { active: true }` | Constraint: no two active rules may share the same priority. Partial = inactive versions are unconstrained. |

### `parcels` collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | |
| `weight` | number | |
| `value` | number | |
| `destinationCountry` | string | |
| `recipient` | object | `{ name, address: { street, houseNumber, postalCode, city } }` |
| `custom` | object | Arbitrary key-value |
| `status` | ParcelStatus | See status enum |
| `batchId` | string ∣ null | Groups parcels from one ingestion run |
| `correlationId` | string | End-to-end trace ID |
| `retryCount` | number | Incremented on stale recovery |
| `claimedBy` | string ∣ null | Worker ID |
| `claimedAt` | Date ∣ null | When claimed |
| `sourceFormat` | `"json"` ∣ `"xml"` | Traceability only |
| `createdAt` | Date | |

**Indexes:**

| Index | Fields | Why |
|-------|--------|-----|
| `idx_parcels_status_createdAt` | `{ status: 1, createdAt: 1 }` | `claimNext()` filters by `status: "RECEIVED"` and sorts by `createdAt` (FIFO). Compound index covers both filter and sort without collection scan. |
| `idx_parcels_batchId` | `{ batchId: 1 }` | Batch-level queries for monitoring/debugging. |

### `outcomes` collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | |
| `parcelId` | string | |
| `correlationId` | string | |
| `department` | string ∣ null | null if UNROUTED |
| `matchedRuleId` | string ∣ null | |
| `matchedRuleVersion` | number ∣ null | |
| `status` | ParcelStatus | |
| `reason` | string | Human-readable explanation |
| `parcelSnapshot` | object | Immutable snapshot at processing time |
| `processedAt` | Date | |

---

## Key design decisions

- **String `_id` (not ObjectId)** — all three collections use `new ObjectId().toHexString()`
  for `_id` values. Stored as strings, not BSON ObjectIds. This matches Phase 2's
  `Rule._id: string` and avoids ObjectId↔string conversion boilerplate throughout
  the codebase. Tradeoff: slightly less storage-efficient (24-char hex string vs
  12-byte ObjectId), negligible at our scale.

- **Partial unique index for priority uniqueness** — the application-level check in
  `RuleRepository.assertUniquePriority()` gives a good error message. But between
  the check and the insert, a concurrent request could create a conflict (TOCTOU race).
  The partial unique index `{ priority: 1 } WHERE { active: true }` is the atomic
  safety net. The app check is for UX; the index is for correctness.

- **`ordered: false` in bulkWrite** — each outcome is independent. Using `ordered: true`
  (the default) would stop at the first failure, silently not writing the remaining
  outcomes. With `ordered: false`, MongoDB attempts ALL operations and reports exactly
  which failed. The result type explicitly separates succeeded and failed IDs.

- **`claimNext` uses `findOneAndUpdate` not `find` + `updateOne`** — a `find` followed
  by `updateOne` has a race window: another worker could claim the same document between
  the two operations. `findOneAndUpdate` is a single atomic operation at the MongoDB
  server level — the document is locked during the operation. This is why we don't need
  an external message queue.

- **`recoverStaleClaims` resets to RECEIVED, not TIMED_OUT** — `TIMED_OUT` is a terminal
  status for parcels that are permanently abandoned. The recovery sweep is about
  re-queueing parcels that can still be processed. It increments `retryCount` so
  a downstream threshold can mark truly stuck parcels as `TIMED_OUT` if desired.

- **Rule versioning via insert-new-document, not update-in-place** — updating a rule
  creates a brand new document with `version + 1` and a new `_id`. The old version
  remains with `active: false`. This preserves a complete audit trail: you can always
  see what version of a rule was active when a parcel was processed, because
  `OutcomeDocument.matchedRuleVersion` references a specific version number.

- **No hard deletes anywhere** — rules are soft-deleted (`active: false`). Parcels
  are never deleted (their status transitions are the audit trail). Outcomes are
  append-only. This design enables full end-to-end traceability.

- **Real MongoDB for tests (not mocks)** — `mongodb-memory-server` runs a real MongoDB
  binary. This is critical because we're specifically testing DB-level atomicity
  guarantees (concurrent `findOneAndUpdate`, bulk write partial failures, unique
  index enforcement). Mocks cannot validate these guarantees.

---

## What this phase does NOT do (yet)

- **No API endpoints** — the repositories are not wired into Fastify routes yet.
  That's Phase 4 (or whichever phase adds the REST API).
- **No app startup wiring** — `connectToDatabase()` and `ensureIndexes()` are not
  called from `apps/api/src/index.ts`. That will be wired when the API routes need
  DB access.
- **No parcel ingestion** — the `ParcelRepository.insertOne()` exists for testing
  purposes. The real ingestion pipeline (XML/JSON → parcel) is Phase 5.
- **No worker pool integration** — `claimNext()` is ready to be called from
  Piscina worker threads, but the pool isn't configured yet.
- **No periodic stale recovery** — `recoverStaleClaims()` is ready to be called
  on a schedule, but no cron/interval is configured yet.
- **No rule loading for the engine** — `findActive()` returns `RuleDocument[]`,
  which can be passed to `RuleEngine.evaluate()` because `RuleDocument extends Rule`.
  But no "rule loading service" coordinates this yet.
- **No connection pooling tuning** — using MongoClient defaults. Production tuning
  (pool size, timeout settings) is a deployment concern.

---

## How to extend this later

**Adding a new collection** (e.g. `audit_logs`):
1. Define the document interface in `packages/shared/src/types/documents.ts`.
2. Add the index definitions in `apps/api/src/db/indexes.ts`.
3. Create a new repository class in `apps/api/src/db/`.
4. Export it from the barrel `apps/api/src/db/index.ts`.
Existing repositories are untouched.

**Adding a field to an existing collection** (e.g. `parcels.priority`):
1. Add the field to the `ParcelDocument` interface in `documents.ts`.
2. Update any Zod schemas that validate input.
3. Update the repository methods that need to read/write the new field.
4. Add indexes if the field will be frequently queried.

**Connecting repositories to Fastify routes**:
1. In `createApp()`, call `connectToDatabase(config.MONGO_URI)`.
2. Instantiate repositories with the returned `db`.
3. Decorate the Fastify instance or use dependency injection to make
   repositories available to route handlers.
4. Call `ensureIndexes(db)` once on startup.
