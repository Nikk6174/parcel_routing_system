# Parcel Routing System — Antigravity Build Prompts (Claude Opus 4.6)

## How to use this document

Run these **one at a time, in order**, in Antigravity. Do not skip ahead or combine phases —
each phase produces a reviewable artifact the next phase depends on. Paste the **Global Context Block**
at the top of *every* prompt (or keep it pinned if Antigravity supports persistent context), followed by
that phase's specific prompt.

Before running a phase, review the output of the previous one. If something's wrong, fix it before
moving forward — errors compound across phases otherwise.

---

## 🔒 Global Context Block (prepend to every single prompt)

```
STACK (do not deviate from this without asking me first):
- Language: TypeScript, strict mode, no `any`, no implicit any
- Backend framework: Fastify
- Validation: Zod
- Database: MongoDB, native driver (NOT Mongoose)
- Worker pool: piscina (Node worker_threads wrapper)
- Frontend: React + Vite (no Next.js)
- Testing: Vitest (or Jest if you strongly prefer — state which and why)
- No message queue (RabbitMQ/Kafka/BullMQ) — we use MongoDB as the async handoff layer,
  via atomic findOneAndUpdate claims. Do not introduce a queue/broker.

HARD RULES:
- Do not invent fields, endpoints, or libraries not specified in this prompt.
- Do not silently swallow errors — every catch block must log with context and either
  rethrow, return a typed error result, or update a status field. Never an empty catch.
- Do not use `any`. If a type is genuinely unknown, use `unknown` and narrow it.
- Before writing code, list your assumptions and any ambiguities you're resolving. If a schema
  or requirement is ambiguous, state your interpretation explicitly rather than guessing silently.
- Follow SOLID principles: routing rule evaluation, rule storage, and rule loading are separate
  concerns and must live in separate modules/classes with clear interfaces between them.
- Every module must be extensible without modifying existing code (Open/Closed Principle) —
  specifically: adding a new rule TYPE or a new department must never require editing the
  core evaluation engine.
- Every function that can fail must have unit tests covering at least: the happy path, one
  boundary value, and one invalid-input case.
- Only implement what THIS phase asks for. Do not touch files outside this phase's scope.
  If you think something in a later phase should change now, tell me — don't just do it.
```

---

## Phase 1 — Project Scaffold & Configuration System

```
Set up the project scaffold only. No business logic yet.

DELIVERABLES:
1. A monorepo structure:
   /apps/api        (Fastify backend)
   /apps/web        (React + Vite frontend)
   /packages/shared (types/schemas shared between api and web)
2. TypeScript config (strict) for each package, with path aliases set up sensibly.
3. A CONFIGURATION SYSTEM — this is a named deliverable, not an afterthought:
   - Environment-level config (port, Mongo URI, log level, rate-limit thresholds) loaded via
     a single typed config module (e.g. `config/env.ts`) that validates required env vars at
     startup using Zod and FAILS FAST with a clear error if anything required is missing.
     Never let the app start with a silently undefined config value.
   - Document, in a README section, the difference between this env-level config and the
     business-rule config (routing rules), which will live in MongoDB and is built in Phase 3.
4. ESLint + Prettier configured for TypeScript strict mode.
5. A root README.md with: how to install, how to run each app, and a placeholder
   "Architecture Decisions" section you will keep appending to in later phases.
6. Package scripts: `dev`, `build`, `test`, `lint` at the root, delegating to each package.

ACCEPTANCE CRITERIA:
- `npm install && npm run dev` starts both apps with no errors, even with no business logic.
- Removing a required env var causes an immediate, readable startup error — not a runtime crash later.

Do not write any routing logic, database schemas, or UI components yet. State your assumptions
about monorepo tooling (npm workspaces vs turborepo vs nx) before you choose one, and pick the
simplest one that satisfies these requirements.
```

---

## Phase 2 — Rule Engine (Pure Logic, No DB)

```
Implement the routing rule engine as pure, dependency-free TypeScript in
/packages/shared/rule-engine. It must not import anything DB-related — it takes data in,
returns data out.

EXACT RULE SHAPE (use this verbatim — do not modify field names):
{
  "_id": string,
  "name": string,
  "version": number,
  "active": boolean,
  "priority": number,
  "type": "condition_rule" | "precondition_rule",
  "conditions": {
    "all"?: Condition[],
    "any"?: Condition[]
  },
  "action": {
    "route_to"?: string,
    "require_approval"?: string,
    "block_until_approved"?: boolean
  }
}

Condition = { field: string; operator: "eq"|"neq"|">"|">="|"<"|"<="|"in"|"not_in"; value: unknown }

PARCEL SHAPE (updated to match the real owner-provided sample, which is XML and does not
include an explicit country field):
{
  weight: number;
  value: number;
  destinationCountry: string;   // see assumption below
  recipient: {
    name: string;
    address: { street: string; houseNumber: string; postalCode: string; city: string };
  };
  custom: Record<string, unknown>;
}
  - Custom/optional attributes MUST be namespaced under `custom.*` — reject or ignore any
    top-level key on the parcel that isn't one of the known fields, to prevent a custom
    attribute from ever overriding a system field during evaluation.
  - ASSUMPTION (state this explicitly in code comments and the phase doc): the source system's
    sample data has no explicit country field. Default `destinationCountry` to "NL" when absent
    at the mapping layer (Phase 5 handles the actual mapping from raw input to this shape) —
    this engine should just treat destinationCountry as a required string it's given, it should
    not itself apply the default. Flag this default as something to confirm with the data owner
    before it's relied on for any customs/cross-border rule.
  - `weight` and `value` must already be numbers by the time they reach this engine — do not
    add type-coercion logic here; that belongs at the ingestion/mapping layer (Phase 5), since
    raw XML text nodes are untyped and coercion is an ingestion concern, not a rule-evaluation
    concern.

DESIGN REQUIREMENTS (this is the core SOLID/extensibility ask):
1. A `ConditionEvaluator` — evaluates one Condition against a parcel. Adding a new operator
   must not require touching rule-matching or engine-orchestration code (use a lookup map of
   operator -> function, not a switch statement embedded in engine logic).
2. A `RuleMatcher` — evaluates one rule's `conditions.all`/`conditions.any` against a parcel,
   using the ConditionEvaluator. Independent, unit-testable in isolation.
3. A `RuleEngine` — takes a parcel + an array of active rules (already sorted/filtered
   externally — the engine does not fetch rules itself), separates precondition_rules from
   condition_rules, evaluates preconditions first, and returns:
   {
     department: string | null,
     matchedRuleId: string | null,
     matchedRuleVersion: number | null,
     reason: string,            // human-readable, e.g. "weight 12kg > 10kg"
     requiresApproval: string | null,
     status: "ROUTED" | "PENDING_APPROVAL" | "UNROUTED"
   }
   If no condition_rule matches, return status "UNROUTED" explicitly — never null/undefined
   silently.
4. Tie-break rule: if two active rules have the same priority and both match, this is a
   CONFIGURATION ERROR. The engine should throw a typed `RuleConflictError` naming both rule
   ids — do not silently pick one. (Priority uniqueness should ideally be enforced at the
   config-validation layer in Phase 3, but the engine must defend against it too.)

TESTS (required, not optional):
- Exact boundary values from the spec: weight = 1, 1.01, 10, 10.01; value = 1000, 1000.01
- A parcel matching a precondition AND a routing rule simultaneously
- A parcel matching no routing rule (UNROUTED)
- Two same-priority rules both matching (RuleConflictError)
- A rule using `conditions.any` (OR logic)
- A custom attribute attempting to shadow a system field (must be ignored/rejected, not
  applied)

Show me your assumptions about how "first match wins" vs "highest priority match wins"
should behave before implementing — state which you chose and why.
```

---

## Phase 3 — MongoDB Layer: Rules, Parcels, Outcomes

```
Implement the MongoDB data layer in /apps/api/src/db. Use the native MongoDB driver.

COLLECTIONS:
1. `routing_rules` — matches the exact rule shape from Phase 2. Add: `createdAt`, `createdBy`.
2. `parcels` — the async handoff/queue-replacement collection. Fields (updated to match the
   real owner-provided sample data shape from Phase 2):
   { _id, weight, value, destinationCountry, recipient: { name, address: { street,
     houseNumber, postalCode, city } }, custom: {}, status: ParcelStatus,
     batchId: string | null, correlationId: string, retryCount: number, claimedBy: string | null,
     claimedAt: Date | null, sourceFormat: "json" | "xml", createdAt: Date }
   - `sourceFormat` is stored purely for traceability/debugging — so you can tell, per parcel,
     which ingestion path it came through, without it affecting routing logic at all.
3. `outcomes` — one per processed parcel:
   { _id, parcelId, correlationId, department, matchedRuleId, matchedRuleVersion,
     status: ParcelStatus, reason: string, parcelSnapshot: object, processedAt: Date }

STATUS ENUM (use verbatim, put it in /packages/shared/types):
RECEIVED, CLAIMED, ROUTED, PENDING_APPROVAL, APPROVED, REJECTED, UNROUTED, FAILED, TIMED_OUT

REQUIREMENTS:
1. A `RuleRepository` class: CRUD for rules, but:
   - Every write is a NEW VERSION (increment `version`), never an in-place mutation of an
     existing version's conditions. `active: false` is how a rule is "deleted" — never
     hard-delete a rule document.
   - Validate every incoming rule against a Zod schema (matching Phase 2's shape) before
     insert. Reject with a clear error listing exactly what's invalid.
   - Enforce no two ACTIVE rules share the same priority (reject at write-time — this backs
     up the RuleConflictError defense in the engine).
2. A `ParcelRepository` class implementing the atomic claim pattern:
   - `claimNext(workerId: string): Promise<Parcel | null>` — uses findOneAndUpdate,
     filter `{status: "RECEIVED"}`, sort by createdAt ascending, sets status to CLAIMED,
     claimedBy, claimedAt. Must be safe under concurrent callers — explain in a comment why
     findOneAndUpdate guarantees this.
   - `recoverStaleClaims(staleAfterMs: number): Promise<number>` — resets any CLAIMED parcel
     older than staleAfterMs back to RECEIVED, returns count reset. This is the TIMED_OUT
     recovery sweep — call it out clearly in a comment.
3. An `OutcomeRepository` class:
   - `bulkWriteOutcomes(outcomes: Outcome[]): Promise<{succeeded: string[], failed: {id: string, error: string}[]}>`
     using `bulkWrite` with `ordered: false` — every outcome is independent, one failure must
     never block or hide the others. Return which specific ones failed and why.
4. Indexes: on `parcels.status`, `parcels.batchId`, `routing_rules.active + priority`. State
   why each index is needed.

TESTS: use an in-memory MongoDB (mongodb-memory-server) or Testcontainers — not mocks — for
these, since we're specifically testing DB-level atomicity guarantees, not just function calls.
Required test: spin up N concurrent claimNext() calls against 1 available parcel, assert
exactly one caller receives it.
```

---

## Phase 4 — Worker Pipeline (piscina) + Retry Logic

```
Implement the background processing pipeline in /apps/api/src/pipeline.

REQUIREMENTS:
1. A piscina worker file that: takes a parcel + the current active rule set (already fetched/
   cached — see requirement 3), runs it through the Phase 2 RuleEngine, and returns the result.
   This file must contain ONLY computation — no DB calls inside the worker thread.
2. An orchestrator loop (runs on the main thread) that:
   - Periodically calls `ParcelRepository.claimNext()` (batch-claim a configurable number,
     e.g. 50, per cycle — not one at a time)
   - Dispatches claimed parcels to the piscina pool
   - Buffers completed results in memory
   - Flushes the buffer via `OutcomeRepository.bulkWriteOutcomes()` either when the buffer
     hits N items OR every T milliseconds, whichever comes first — implement both triggers.
   - For any outcome that failed to write (from bulkWrite's failed list) OR that the rule
     engine returned as UNROUTED/errored: increment retryCount; if retryCount < 3, reset
     status to RECEIVED; else set status to FAILED and log at error level with full context
     (correlationId, parcelId, reason).
3. Call `ParcelRepository.recoverStaleClaims()` on its own separate interval (e.g. every 30s),
   independent of the main processing loop.
4. Every parcel must carry a `correlationId` from the moment it's written as RECEIVED —
   generate it in Phase 5's API layer, not here, but every log line and DB write in this
   pipeline must include and pass through the existing correlationId. Never generate a new one
   mid-pipeline.

EXPLICITLY CALL OUT IN COMMENTS:
- The durability trade-off: results sitting in the in-memory buffer before a flush are not yet
  durable. If the process crashes between buffering and flushing, those specific results are
  lost from Mongo's perspective even though the worker completed them. State the max data-loss
  window given your chosen buffer size/interval.

TESTS:
- A batch of parcels where some rule-engine calls throw — assert the pipeline doesn't crash,
  and those specific parcels get retried, not the whole batch.
- Simulate exceeding max retries — assert final status is FAILED, not an infinite loop.
- Assert buffer flushes on the time trigger even when the count trigger hasn't been hit.
```

---

## Phase 5 — API Routes (Fastify)

```
Implement API routes in /apps/api/src/routes. Use Zod schemas (from /packages/shared) for
every request body — reject anything not matching the schema with a 400 and a structured,
row-level error where applicable (never a raw stack trace to the client).

ENDPOINTS:
1. `POST /parcels` — single parcel submit. Validates body, generates a correlationId, writes
   parcel as RECEIVED, returns 202 with { parcelId, correlationId } immediately. Does NOT wait
   for routing to complete.
2. `POST /parcels/batch` — accepts a multipart file upload, **both JSON and XML** (updated:
   the owner's real sample data is an XML `<Container><parcels><Parcel>...` format, not JSON —
   we must support their actual upstream format, not just our originally-assumed one).
   - Detect format from file extension/content-type, route to the appropriate parser.
   - MUST stream-parse the file server-side for both formats (do not buffer the whole file
     into memory or fully parse it in one shot). Use a streaming JSON parser for `.json` and a
     streaming XML parser (e.g. `saxes` or `sax`) for `.xml`. Enforce a max file size, reject
     larger files before parsing.
   - XML MAPPING LAYER: map `Container.parcels.Parcel` nodes into the internal parcel shape
     from Phase 2/3:
     `Parcel.Weight` -> weight, `Parcel.Value` -> value,
     `Parcel.Receipient.Name` -> recipient.name,
     `Parcel.Receipient.Address.{Street,HouseNumber,PostalCode,City}` -> recipient.address.*
   - TYPE COERCION: explicitly coerce Weight/Value text nodes to numbers (do not assume the
     XML parser typed them — real sample data mixes "0.02", "11", "0.0", "500" as plain text).
     If coercion produces NaN, reject that specific row as FAILED with reason "invalid weight/
     value", do not fail the whole batch.
   - COUNTRY DEFAULT: if no country field is present in the source data (true of the current
     XML sample), set `destinationCountry: "NL"` at this mapping layer and record this default
     was applied in a `custom._assumedCountry: true` flag on the parcel, so it's traceable and
     not silently indistinguishable from a real value.
   - Validate each mapped row against the parcel schema as it streams; invalid rows are
     recorded immediately as FAILED with a specific reason (do not fail the whole upload for
     one bad row). Rows with identical content (same recipient/weight/value) are NOT
     considered duplicates by default — treat them as distinct legitimate parcels unless told
     otherwise; duplicate-detection stays at the whole-file-hash level, not per-row content.
   - Generate a shared `batchId` for the whole upload; each parcel gets its own correlationId
     but shares the batchId.
   - Return 202 immediately with { batchId, totalRows, acceptedRows, rejectedRows } — do not
     wait for routing.
3. `GET /parcels/batch/:batchId/status` — returns aggregate counts per status for that batch,
   for polling. Must be a cheap aggregation query, not fetching every row.
4. `GET /parcels/:parcelId` — returns the single parcel's current status + outcome if available.
5. `POST /rules` and `PUT /rules/:id` — admin-only (assume an `authorize(role)` middleware
   exists as a stub for now; wire real auth in Phase 7), validates against the rule schema
   from Phase 2/3, calls RuleRepository.
6. `POST /parcels/:parcelId/approve` and `/reject` — insurance-approver-only (stub role check
   for now), flips PENDING_APPROVAL to APPROVED/REJECTED.

REQUIREMENTS:
- Idempotency: `POST /parcels` and `/parcels/batch` must accept an `Idempotency-Key` header;
  if a request with the same key was already processed, return the original result instead of
  creating a duplicate.
- Attach correlationId to every log line via Fastify's request-scoped logger (use `req.log`,
  not a global logger) — show me how correlationId flows from the incoming request through to
  the DB write.

TESTS: integration tests hitting real HTTP endpoints against a test DB — assert status codes,
response shapes, and that a genuinely malformed file returns a clear top-level error rather
than a partial/confusing table.
```

---

## Phase 6 — Frontend (React + Vite)

```
Implement the frontend in /apps/web. Plain React, no Next.js. Prioritize clarity for a
non-technical operator over visual complexity.

SCREENS:
1. Single-parcel form: weight, value, destinationCountry, optional custom attributes
   (key/value pairs, clearly namespaced/labeled as custom). On submit, show immediate
   "Submitted — tracking result..." state, then poll `/parcels/:id` until terminal status.
2. Batch upload: file picker (JSON only), client-side pre-check of file type/size ONLY for
   fast feedback — clearly comment that this is NOT a security boundary, real validation is
   server-side. On upload, show a progress/summary view immediately (acceptedRows/
   rejectedRows from the 202 response), then poll `/parcels/batch/:id/status` for aggregate
   counts, rendered as a live-updating summary: "X routed, Y held, Z failed, W pending" —
   never a single pass/fail indicator for the whole batch.
3. Results table: server-side paginated (do not fetch all rows at once), one row per parcel,
   status color-coded, clickable row to see matchedRuleId + reason for ROUTED, or the specific
   error for FAILED. Virtualize the table if rendering more than ~200 rows at once.
4. A distinct, visually clear "Held for approval" state and an approve/reject action for that
   role.

REQUIREMENTS:
- Sanitize any user-entered text before rendering it back anywhere (prevent stored XSS from
  custom attributes).
- Polling must back off or stop once a batch reaches 100% terminal statuses — do not poll
  forever.
- Handle the polling connection dropping (e.g. laptop sleep) — show a "reconnecting..." or
  "may be stale" indicator, don't silently show a frozen state as if it were live.

TESTS: component tests for the results table's per-row status rendering, and for the
batch-summary aggregation display given a mocked partial-failure response shape.
```

---

## Phase 7 — Security Middleware

```
Implement security middleware in /apps/api/src/security, wired into the Fastify app from
Phase 5.

REQUIREMENTS:
1. Real authentication: OIDC/JWT verification middleware (assume a JWT with a `role` claim:
   "operator" | "insurance_approver" | "admin"). Replace the Phase 5 auth stubs with real
   role checks now.
2. Rate limiting: per-user/per-API-key, backed by Redis if available, else in-memory for now
   with a comment on why Redis is the production choice (shared state across instances).
3. Input sanitization: a shared sanitize utility applied to any free-text field before it's
   stored (custom attributes) — used by both the batch upload path and single-submit path.
4. Strict Zod validation on every route (should already exist from Phase 5 — audit and close
   any gaps, especially rejecting unknown fields with `.strict()`).
5. Security headers: helmet-equivalent for Fastify (@fastify/helmet), HTTPS enforcement
   assumption documented (actual TLS termination happens at the load balancer — note this).
6. Document in README (append, don't replace) what's out of scope for the app layer and
   handled at infra: WAF/CDN, DDoS filtering, secrets manager — explain why these are
   infra-level, not application-code concerns, and reference where you'd configure them
   (e.g. Cloudflare/AWS WAF in front of this service).

TESTS: a request with an invalid/expired JWT is rejected; a request exceeding the rate limit
gets a 429; a request with an extra unexpected field is rejected, not silently accepted.
```

---

## Phase 8 — Observability

```
Implement observability in /apps/api/src/observability.

REQUIREMENTS:
1. Structured JSON logging (pino, since Fastify uses it natively) — every log line includes
   correlationId when available. Configure log levels via the Phase 1 config module.
2. Prometheus metrics endpoint (`/metrics`) exposing at minimum:
   - parcels_processed_total (counter, labeled by status and department)
   - parcel_processing_duration_seconds (histogram)
   - pending_parcels_count (gauge — count of RECEIVED + CLAIMED)
   - failed_parcels_count (gauge)
3. A simple ratio-based drift check: a scheduled job that computes department distribution
   over the last hour and logs a WARN (and increments a `routing_drift_detected` counter) if
   any department's share deviates more than a configurable threshold from its trailing 7-day
   average. Keep this simple — no ML, just a ratio comparison, and say so in a comment.
4. Health endpoints: `/health` (process is up) and `/ready` (Mongo is reachable).
5. Error tracking: wire a Sentry SDK call (or a clearly marked stub if no DSN is configured)
   on unhandled exceptions and on any FAILED-status transition, including correlationId in
   the context.

TESTS: assert /metrics returns the expected metric names after processing a known set of
parcels; assert /ready returns 503 if Mongo is unreachable (mock the connection failure).
```

---

## Phase 9 — Integration Tests, Regression Suite & CI

```
Set up the test/CI layer in /apps/api and /apps/web, plus a GitHub Actions workflow.

REQUIREMENTS:
1. Consolidate and audit all tests written in Phases 2-8 — make sure they all run under one
   command (`npm run test`) and are fast enough to run on every PR (mock/testcontainer-based,
   not requiring manually-started external services).
2. Add end-to-end tests (a small, deliberate number — 3 to 5 max) covering full user journeys:
   - Submit a single parcel below 1kg -> ends up ROUTED to MAIL
   - Upload a batch with one valid, one invalid, one insurance-triggering row -> assert all
     three end states are correct and independent
   - Add a new rule via the API, submit a parcel matching only that new rule -> correctly
     routed, proving live rule extension works without a redeploy
3. GitHub Actions workflow (.github/workflows/ci.yml):
   - Runs on every PR: lint -> typecheck -> unit tests -> integration tests -> build
   - Fails the PR if any step fails; do not allow merge on red CI (document this as a branch
     protection recommendation in the README, since CI config alone doesn't enforce it)
4. Write a concrete example in README.md titled "Adding a new rule safely — branch to merge":
   a realistic walkthrough (git commands + what test you'd add + what CI does) using the
   Phase 2 rule engine and Phase 3 repository, showing how an existing boundary test catching
   a regression would block a bad merge. Make this example specific and runnable, not
   hand-wavy.

Finish by appending a final "Known Limitations & Scaling Path" section to the README covering:
why MongoDB-as-queue was chosen over a message broker, the assumed initial scale (state it
explicitly as an assumption), the specific bottleneck (Mongo write/claim contention) that
would appear beyond that scale, and what you'd introduce (RabbitMQ, Mongo sharding) if it did.
```
