# Phase 4 — Background Processing Pipeline

> **Status:** ✅ Complete
> **Depends on:** Phase 2 (rule engine), Phase 3 (repositories)
> **Next phase:** Phase 5

---

## What was implemented

Phase 4 adds the background processing pipeline in `apps/api/src/pipeline/`.
It connects the Phase 2 rule engine to the Phase 3 data layer through a
worker-pool-based processing loop with buffered writes and retry logic.

### Files created

| Location | File | Responsibility |
|----------|------|----------------|
| `apps/api/src/pipeline/` | `types.ts` | WorkerInput/Output, WorkerPool, Logger, PipelineConfig |
| | `worker.ts` | Piscina worker file — pure computation, no I/O |
| | `result-buffer.ts` | Buffer with count + time flush triggers |
| | `orchestrator.ts` | Main processing loop: claim → dispatch → buffer → flush |
| | `index.ts` | Barrel export |
| | `worker.test.ts` | Worker function unit tests |
| | `result-buffer.test.ts` | Buffer flush trigger tests |
| | `orchestrator.test.ts` | Integration tests with mongodb-memory-server |

### Files modified

| File | Change | Why |
|------|--------|-----|
| `apps/api/src/db/parcel-repository.ts` | Added `requeue()` and `markFailed()` | Pipeline needs atomic retry/fail operations |

### Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `worker.test.ts` | 4 | ROUTED, UNROUTED, engine throws, empty rules |
| `result-buffer.test.ts` | 4 | Count flush, time flush, empty flush, manual flush |
| `orchestrator.test.ts` | 4 | Partial failures, max retries → FAILED, UNROUTED retry, empty batch |
| **Phase 4 total** | **12** | |
| **Cumulative total** | **125** | (Phase 1: 8 + Phase 2: 77 + Phase 3: 28 + Phase 4: 12) |

---

## How this connects with previous phases

```
Phase 2:                     Phase 3:                     Phase 4:

rule-engine/                 db/                          pipeline/
  RuleEngine ◄───────────────── RuleRepository ◄────────── orchestrator.ts
  (pure evaluation)            .findActive()                (caches rules)
                                                            
                               ParcelRepository ◄────────── orchestrator.ts
                               .claimNext()                 (batch-claims)
                               .requeue()                   (retries)
                               .markFailed()                (permanent fail)
                               .recoverStaleClaims()        (stale sweep)
                                                            
                               OutcomeRepository ◄───────── orchestrator.ts
                               .bulkWriteOutcomes()         (flush handler)
                                                            
  evaluate(parcel, rules) ◄──────────────────────────────── worker.ts
                                                            (piscina worker)
```

### Data flow per cycle

```
1. orchestrator.processCycle()
   │
   ├─ refreshRulesIfNeeded()           ← RuleRepository.findActive()
   │   └─ cached in memory, TTL-based
   │
   ├─ batchClaim()                     ← ParcelRepository.claimNext() × N
   │   └─ concurrent atomic claims
   │
   ├─ Promise.allSettled(pool.run())   ← Worker threads (or mock in tests)
   │   ├─ fulfilled → buffer.add()
   │   └─ rejected  → buffer.add() with error
   │
   └─ buffer accumulates results
       │
       ├─ Count trigger: size ≥ maxSize → flush()
       └─ Time trigger:  setTimeout → flush()
           │
           └─ handleFlush()
               ├─ Successful (ROUTED/PENDING_APPROVAL):
               │   ├─ OutcomeRepository.bulkWriteOutcomes()
               │   └─ ParcelRepository.updateStatus()
               │
               └─ Retry (UNROUTED/errored/write-failed):
                   ├─ retryCount < maxRetries → requeue()
                   └─ retryCount ≥ maxRetries → markFailed() + FAILED outcome
```

---

## Execution flow

### Processing pipeline lifecycle

```
start()
  ├─ Start claim loop (while running)
  │   └─ processCycle() → sleep(claimIntervalMs) → repeat
  │
  └─ Start stale sweep (setInterval, independent)
      └─ recoverStaleClaims() every staleSweepIntervalMs

stop()
  ├─ Set running = false
  ├─ Clear sweep timer
  ├─ Wait for in-flight cycle
  ├─ Flush remaining buffer
  └─ Destroy worker pool
```

### Retry decision tree

```
Result received:
  │
  ├─ output.error !== null? ──────────────────── YES → RETRY
  │
  ├─ output.result.status === 'UNROUTED'? ────── YES → RETRY
  │
  └─ output.result.status is ROUTED/PENDING ──── → WRITE OUTCOME
      │
      └─ bulkWrite failed for this outcome? ──── YES → RETRY

RETRY:
  ├─ retryCount + 1 < maxRetries → requeue(parcelId)
  │   └─ status = RECEIVED, claimedBy = null, retryCount++
  │
  └─ retryCount + 1 ≥ maxRetries → markFailed(parcelId)
      ├─ status = FAILED, retryCount++
      └─ write FAILED outcome for audit trail
```

---

## Durability trade-off

Results sitting in the in-memory buffer before a flush are NOT yet durable
in MongoDB. If the process crashes between a worker completing and the next flush:

| Parameter | Default | Impact |
|-----------|---------|--------|
| `bufferMaxSize` | 50 | Up to 50 completed results could be lost |
| `bufferFlushIntervalMs` | 5000ms | Up to 5 seconds of results could be lost |
| **Max data-loss window** | **min(50 results, 5 seconds)** | |

**Recovery mechanism:** The parcels remain in CLAIMED status in MongoDB.
The stale claim recovery sweep (every 30s by default) resets them to RECEIVED
after `staleAfterMs` (5 minutes), so they'll be reprocessed. The trade-off is
duplicated computation, not permanent data loss.

---

## correlationId tracing

Every parcel carries a `correlationId` from the moment it enters the system
(generated by Phase 5's ingestion layer). The pipeline NEVER generates a new
correlationId — it passes through the existing one at every point:

| Where | How |
|-------|-----|
| Worker output | `output.correlationId = input.parcel.correlationId` |
| OutcomeDocument | `outcome.correlationId = parcel.correlationId` |
| Logger (error) | `logger.error('...', { correlationId: parcel.correlationId })` |
| Logger (warn) | `logger.warn('Retrying...', { correlationId })` |

---

## Key design decisions

- **WorkerPool interface (DI) instead of direct Piscina dependency** — the
  orchestrator accepts a `WorkerPool` interface, not a concrete `Piscina`
  instance. Tests inject a mock pool. Production injects a real Piscina.
  The orchestrator is testable without real worker threads.

- **Worker catches all errors and returns them as data** — the worker function
  wraps `engine.evaluate()` in try/catch and returns `{ error: "..." }` instead
  of throwing. This means the orchestrator always gets a `WorkerOutput`, even
  when the engine throws `RuleConflictError`. The only way the worker can
  fail as a rejected promise is if the thread itself crashes — handled by
  `Promise.allSettled`.

- **`Promise.allSettled` not `Promise.all`** — one worker failure must never
  crash the entire batch. `Promise.allSettled` gives us a per-parcel
  settled/rejected status.

- **Buffer uses `setTimeout` not `setInterval`** — the timer starts when the
  first item is added, fires once. A new timer starts after the next flush.
  No unnecessary ticks when the buffer is empty.

- **Stale sweep on its own interval, independent of the claim loop** — if the
  claim loop is slow (heavy batch), the sweep still runs on schedule. If the
  sweep is slow (many stale claims), the claim loop isn't blocked.

- **UNROUTED parcels are retried, not immediately finalized** — rules might
  be updated between attempts. If a parcel is UNROUTED on all 3 retries, it
  gets a FAILED outcome documenting the last reason.

- **One FAILED outcome per permanently-failed parcel** — retried parcels don't
  get intermediate outcomes. Only the final FAILED result is written to the
  outcomes collection. This keeps the 1-outcome-per-parcel invariant.

- **Rule cache with configurable TTL** — rules are loaded once per TTL period
  (default 30s), not once per parcel. The same rule set is reused across the
  entire batch. This reduces DB load while still picking up rule changes
  within a reasonable time window.

---

## What this phase does NOT do (yet)

- **No API endpoints** — the pipeline is started programmatically, not via HTTP.
- **No parcel ingestion** — parcels must already exist as RECEIVED in MongoDB.
  Phase 5 adds the ingestion API.
- **No Piscina wiring at app startup** — the `createPiscinaPool()` factory and
  app lifecycle integration will be added when the app entry point is wired.
- **No metrics/monitoring** — processing rate, queue depth, retry counts are
  logged but not exposed as metrics.
- **No configurable worker count** — Piscina defaults to one worker per CPU
  core. Custom thread pool sizing is a deployment concern.

---

## How to extend this later

**Adding a new outcome handler** (e.g. webhook notification after ROUTED):
Add logic after the `updateStatus` call in `handleFlush()`. The outcome is
already written — the new handler just needs to read it and dispatch.

**Adding processing metrics**:
Inject a metrics interface alongside Logger. The orchestrator already has
the data points: batch size, flush size, retry count, cycle duration.

**Switching to real Piscina**:
Create a `PiscinaWorkerPool` wrapper that implements `WorkerPool`:
```typescript
const pool = new Piscina({ filename: '/path/to/compiled/worker.js' });
return { run: (d) => pool.run(d), destroy: () => pool.destroy() };
```
Pass this to the orchestrator constructor. No orchestrator changes needed.
