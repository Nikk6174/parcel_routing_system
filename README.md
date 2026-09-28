# Parcel Routing System

A production-ready internal parcel routing system that processes parcels and routes them to departments based on configurable business rules. Built with a TypeScript monorepo architecture, a Fastify API server, a React frontend, and MongoDB for persistence.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Decisions](#architecture-decisions)
- [Project Structure](#project-structure)
- [1. Parcel Routing](#1-parcel-routing)
- [2. User Interface](#2-user-interface)
- [3. Quality Assurance](#3-quality-assurance)
- [4. Monitoring & Reliability](#4-monitoring--reliability)
- [5. Security](#5-security)
- [6. Extending the System with New Routing Rules](#6-extending-the-system-with-new-routing-rules)
- [Trade-offs](#trade-offs)
- [AI Usage Documentation](#ai-usage-documentation)

---

## Quick Start

### Prerequisites

- Node.js 20+
- MongoDB (Atlas connection string or local instance)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/Nikk6174/parcel_routing_system.git
cd parcel_routing_system

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set MONGO_URI and JWT_SECRET (min 32 chars)

# 4. Start development (all 3 packages concurrently)
npm run dev
```

This starts:
- **API server** on `http://localhost:3001`
- **Web frontend** on `http://localhost:5173`

### Running Tests

```bash
npm test          # Run all 162 tests
npm run lint      # ESLint
npm run build     # TypeScript compilation + Vite production build
```

### Environment Variables

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `MONGO_URI` | Yes | — | MongoDB connection string |
| `JWT_SECRET` | Yes | — | HS256 secret (min 32 chars) |
| `PORT` | | `3001` | API server port |
| `LOG_LEVEL` | | `info` | Pino log level |
| `RATE_LIMIT_MAX` | | `100` | Requests per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | | `60000` | Rate-limit window (ms) |
| `SENTRY_DSN` | | — | Sentry DSN (omit to disable) |
| `SENTRY_ENVIRONMENT` | | `development` | Sentry environment tag |

All configuration is validated at startup using Zod (`apps/api/src/config/env.ts`). If any required variable is missing or invalid, the application fails fast with a clear, enumerated error message rather than starting in a broken state.

---

## Architecture Decisions

### Monorepo with npm Workspaces

```
parcel-routing-system/
├── packages/shared/    ← Rule engine, types, schemas (shared library)
├── apps/api/           ← Fastify backend (REST API + pipeline)
└── apps/web/           ← React + Vite frontend
```

**Why a monorepo?** The rule engine is consumed by both the API (for evaluation) and could be consumed by future services. Keeping it in `packages/shared` with its own `tsconfig.json` and build step means:
- A single `npm install` sets up everything.
- TypeScript project references ensure type safety across package boundaries.
- Changes to the shared rule engine are immediately reflected in both consumers without publishing to npm.

### Technology Choices

| Choice | Rationale |
| :--- | :--- |
| **TypeScript** | Type safety across the full stack; catches class of bugs at compile time. |
| **Fastify** | Fastest mainstream Node.js HTTP framework. Built-in schema validation, plugin system, structured logging (Pino). |
| **MongoDB** | Schema-flexible documents fit the parcel model (optional custom attributes) without migrations. Atomic `findOneAndUpdate` enables the claim-based pipeline. |
| **React + Vite** | React for component-based UI. Vite for sub-second HMR during development. |
| **Vitest** | Compatible with the Vite toolchain. Fast test execution with native ESM support. |
| **Zod** | Runtime schema validation for both API input and environment config. Strict mode rejects unknown fields. |

### Claim-Based Pipeline (Not a Queue)

Instead of using an external message queue (RabbitMQ, SQS), the system uses a **claim-based pipeline** built on MongoDB's atomic `findOneAndUpdate`:

```
[Parcel Ingested] → status: RECEIVED
        ↓
[Orchestrator Tick] → claims parcel via atomic findOneAndUpdate
        ↓                (status: RECEIVED → CLAIMED, sets claimedBy + claimedAt)
[Rule Engine Evaluates] → determines department or approval requirement
        ↓
[Outcome Recorded] → status: ROUTED / PENDING_APPROVAL / UNROUTED
```

**Why not a dedicated queue?** For the scale of this system, adding RabbitMQ/Redis would introduce operational overhead (another service to deploy, monitor, and secure) without proportional benefit. The MongoDB-based approach provides:
- **Exactly-once processing**: Atomic claim prevents two workers from processing the same parcel.
- **Stale claim recovery**: If a worker crashes mid-processing, the orchestrator detects stale claims (>60s) and resets them to `RECEIVED` for reprocessing.
- **Retry with backoff**: Failed parcels are retried up to 3 times before being marked `FAILED`.
- **No additional infrastructure**: Everything runs on the same MongoDB instance already required for storage.

**Trade-off**: This approach has a throughput ceiling compared to a dedicated queue. For a system processing thousands of parcels per second, migrating to a message broker would be the right move. For an internal parcel routing system, the MongoDB-based pipeline is simpler and sufficient.

---

## Project Structure

```
packages/shared/src/
├── rule-engine/
│   ├── types.ts                 # Parcel, Rule, Condition interfaces
│   ├── rule-engine.ts           # Main engine: evaluate parcel against rules
│   ├── rule-matcher.ts          # Match a single rule against a parcel
│   ├── condition-evaluator.ts   # Evaluate a single condition
│   ├── field-resolver.ts        # Resolve dot-path fields (system + custom.*)
│   ├── operators.ts             # Operator registry (eq, >, <, in, etc.)
│   └── errors.ts                # Typed errors (FieldResolution, Operator)
├── schemas/                     # Shared Zod schemas (parcel input validation)
└── types/                       # Shared document types (RuleDocument, etc.)

apps/api/src/
├── config/env.ts                # Zod-validated environment configuration
├── db/
│   ├── parcel-repository.ts     # CRUD + atomic claim + stale recovery
│   ├── rule-repository.ts       # Rule CRUD with versioning + priority shift
│   ├── outcome-repository.ts    # Routing outcomes (audit trail)
│   ├── idempotency-repository.ts# Idempotency key store
│   ├── indexes.ts               # MongoDB index definitions
│   └── schemas.ts               # Rule creation Zod schema
├── pipeline/
│   ├── orchestrator.ts          # Main processing loop (tick-based)
│   ├── worker.ts                # Single-parcel processing logic
│   ├── result-buffer.ts         # Batched write buffer for outcomes
│   └── types.ts                 # Pipeline configuration types
├── routes/
│   ├── parcel-routes.ts         # POST /parcels, GET /parcels/:id
│   ├── batch-routes.ts          # POST /parcels/batch (JSON + XML)
│   ├── rule-routes.ts           # GET/POST/PUT /rules (admin)
│   └── approval-routes.ts       # POST /parcels/:id/approve|reject
├── parsers/
│   ├── json-stream-parser.ts    # Streaming JSON batch parser
│   └── xml-stream-parser.ts     # Streaming SAXes XML parser
├── security/
│   ├── jwt-auth.ts              # JWT verification + role extraction
│   ├── sanitize.ts              # HTML stripping + input sanitization
│   └── index.ts                 # authorize() middleware
├── observability/
│   ├── sentry.ts                # Sentry SDK init + cron check-ins
│   ├── metrics.ts               # Custom Sentry metrics (counters, gauges)
│   ├── drift.ts                 # Z-score routing drift detection
│   └── index.ts                 # Correlation ID middleware
├── middleware/
│   └── authorize.ts             # Role-based access control middleware
├── e2e/
│   └── e2e.test.ts              # End-to-end journey tests
├── app.ts                       # Fastify app factory + plugin registration
└── index.ts                     # Server entry point + graceful shutdown

apps/web/src/
├── pages/
│   ├── ParcelForm.tsx           # Single parcel submission + live tracking
│   ├── BatchUpload.tsx          # Batch file upload (JSON/XML) + status
│   ├── RulesPage.tsx            # Admin: view + create routing rules
│   ├── ApprovalQueue.tsx        # Insurance approver: approve/reject parcels
│   ├── ResultsTable.tsx         # Paginated parcel results with filtering
│   └── LoginPage.tsx            # Role-based login (operator/admin/approver)
├── components/
│   ├── StatusBadge.tsx          # Color-coded parcel status badges
│   └── ConnectionIndicator.tsx  # Polling health indicator
├── hooks/
│   └── usePolling.ts            # Generic polling hook with staleness detection
├── auth/
│   └── AuthContext.tsx          # React context for role-based auth state
├── api/
│   └── client.ts                # API client (fetch wrapper + dev JWT tokens)
├── App.tsx                      # Router + navigation + role switching
└── index.css                    # Full design system (CSS custom properties)
```

---

## 1. Parcel Routing

### Default Rules (As Specified)

| Priority | Condition | Action |
| :---: | :--- | :--- |
| 1 | Weight up to 1 kg | Route to Mail Department |
| 2 | Weight up to 10 kg | Route to Regular Department |
| 3 | Weight over 10 kg | Route to Heavy Department |
| 4 | Value greater than 1,000 euros | Require Insurance Approval |

Rules are evaluated in **priority order** (lowest number = highest precedence). The first matching rule wins.

### How Business Rules Are Made Adaptable

The routing logic is implemented as a **composable rule engine** in `packages/shared/src/rule-engine/`. Rules are **data, not code** — they are stored as documents in MongoDB and evaluated at runtime.

**Rule structure:**
```json
{
  "name": "Mail Department (lightweight)",
  "priority": 1,
  "type": "condition_rule",
  "conditions": {
    "all": [{ "field": "weight", "operator": "<=", "value": 1 }]
  },
  "action": { "route_to": "Mail" }
}
```

**Key design properties:**

1. **No code changes needed for new rules.** An admin creates a new rule via the UI or API, and the orchestrator picks it up on its next tick without a redeploy.

2. **Priority-based ordering with auto-shift.** When a new rule is created at a priority that already exists, all rules at that priority and below automatically shift down by 1. This means the admin can always insert a rule exactly where they want it in the evaluation order.

3. **Immutable versioning.** Rule updates create a new version (old version is deactivated, never mutated). This provides a full audit trail and allows rollback.

4. **Two rule types:**
   - `condition_rule`: Routes the parcel to a department.
   - `precondition_rule`: Requires approval before routing continues (e.g., insurance approval for high-value parcels).

5. **Custom attributes** via the `custom.*` namespace. Parcels carry a `custom` object for arbitrary metadata (e.g., `custom.fragile`, `custom.temperatureControlled`). Rules can reference these fields using dot-path resolution. System fields (`weight`, `value`, `destinationCountry`) cannot be shadowed by custom attributes — the field resolver enforces strict namespace separation.

6. **Operator extensibility.** The operator registry (`packages/shared/src/rule-engine/operators.ts`) supports `eq`, `neq`, `>`, `>=`, `<`, `<=`, `in`, `not_in`, and can be extended with custom operators without modifying existing code.

### How Rule Changes Can Impact System Correctness and Safety

The system addresses this through several mechanisms:

- **Priority ordering prevents ambiguity.** Rules are evaluated in strict priority order and the first match wins. There is no undefined behavior when multiple rules could match.
- **Immutable audit trail.** Every routing outcome records the exact rule ID and version that was applied. If a rule change causes incorrect routing, the historical decisions are traceable and auditable.
- **Routing drift detection.** A z-score based anomaly detector compares each department's recent traffic share against its 7-day baseline. If a rule change causes an unusual shift in routing patterns, it is flagged automatically (see Monitoring section).
- **No-downtime rule changes.** The orchestrator refreshes its in-memory rule cache after every rule creation or update. There is no stale rule window and no need for a redeploy.

### Adding a New Department or Condition

To add a "Fragile Handling Department" that routes parcels marked as fragile:

1. **Operators** tag incoming fragile parcels with `fragile: yes` in the custom attributes section of the parcel form.
2. **Admin** creates a rule via the Rules page:
   - Field: `custom.fragile`, Operator: `eq`, Value: `yes`
   - Route to: `Fragile Handling`
   - Priority: 1 (to evaluate before weight-based rules)
3. **No code changes, no database migrations, no redeployment required.**

---

## 2. User Interface

### Design Principles

The interface is designed for **non-technical warehouse operators** who process parcels at a sorting facility. It prioritizes:

- **Clarity**: Every routing decision shows the matched rule, target department, and reason. Status badges are color-coded (green for routed, yellow for pending, red for failed).
- **Responsiveness**: The CSS design system uses custom properties and responsive layouts that work on both desktop and tablet screens.
- **Real-time feedback**: After submitting a parcel, the UI polls the API every 2 seconds and displays live status updates until the parcel reaches a terminal state.
- **Connection health**: A `ConnectionIndicator` component shows whether polling is active, stale, or disconnected.

### Pages

| Page | Role | Purpose |
| :--- | :--- | :--- |
| **Submit Parcel** | Operator | Enter parcel data (weight, value, country, recipient, custom attributes) and track routing in real time |
| **Batch Upload** | Operator | Upload JSON or XML files containing multiple parcels. Displays accepted/rejected counts, validation errors per row, and live batch status with manual refresh |
| **Results Table** | All | Paginated table of all parcels with status filtering, search by parcel ID, and click-through to detailed outcome view |
| **Approval Queue** | Insurance Approver | List of parcels pending insurance approval with approve/reject actions |
| **Rules Management** | Admin | View all active routing rules sorted by priority; create new rules with conditions, operators, and actions |
| **Login** | All | Role selection (Operator, Admin, Insurance Approver) with dev JWT tokens |

### Batch Upload: JSON and XML

Both JSON and XML formats are supported for batch ingestion. The system uses **streaming parsers** to handle large files without loading the entire file into memory:

- **JSON**: `json-stream-parser.ts` — Parses the JSON array and validates each parcel individually.
- **XML**: `xml-stream-parser.ts` — Uses the SAXes streaming XML parser. XML elements are normalized to the internal parcel schema (e.g., `<Weight>` becomes `weight`, `<Receipient>` becomes `recipient`). If no `<DestinationCountry>` is provided, it defaults to `NL` and flags the parcel with `custom._assumedCountry: true`.

**Why support both?** JSON is the developer-friendly default. XML is supported because legacy logistics systems and enterprise integrations (customs declarations, carrier manifests) frequently use XML. The streaming SAXes parser ensures that XML External Entity (XXE) attacks are structurally impossible — SAXes does not resolve external entities or DTDs.

**Validation**: Each row is validated independently. Valid parcels are accepted; invalid ones are rejected with a per-row error message. A single bad row does not fail the entire batch.

---

## 3. Quality Assurance

### Test Suite Overview

The project has **162 tests** across **16 test files**, all passing. Tests run using Vitest with `mongodb-memory-server` (an in-memory MongoDB instance) for integration tests — no external database required.

| Layer | Test Files | What They Cover |
| :--- | :--- | :--- |
| **Rule Engine (Unit)** | `rule-engine.test.ts`, `rule-matcher.test.ts`, `condition-evaluator.test.ts`, `field-resolver.test.ts`, `operators.test.ts` | Operator logic, field resolution (including `custom.*` namespace, shadowing protection), condition evaluation, rule matching, precondition rules, `all`/`any` combinators |
| **Repositories (Integration)** | `parcel-repository.test.ts`, `rule-repository.test.ts`, `outcome-repository.test.ts` | Atomic claim, concurrent claim safety, stale claim recovery, FIFO ordering, priority shifting, rule versioning, rule deactivation |
| **Pipeline (Integration)** | `orchestrator.test.ts`, `worker.test.ts`, `result-buffer.test.ts` | Orchestrator tick processing, retry with backoff, max-retry failure, hot rule reload (no redeploy), batched writes |
| **API Routes (Integration)** | `routes.test.ts` | HTTP status codes, Zod validation errors, idempotency, JWT auth (missing/invalid/expired/wrong-role tokens), rate limiting headers, strict schema rejection |
| **Observability** | `observability.test.ts`, `drift.test.ts` | Correlation IDs, `/health` and `/ready` endpoints, stale heartbeat detection, z-score drift detection math |
| **UI Components** | `StatusBadge.test.tsx`, `BatchCounts.test.tsx` | Component rendering, status-to-color mapping |
| **End-to-End** | `e2e.test.ts` | Full journeys: single parcel routing, batch with mixed valid/invalid/insurance rows, hot rule addition |

### How Tests Protect Against Regressions

1. **Rule engine tests verify every operator and edge case.** If someone modifies the `>=` operator, the test that checks `5 >= 5 is true` and `4 >= 5 is false` will catch the regression immediately.

2. **Concurrent claim test.** A test spawns 10 parallel `claimNext()` calls against a single parcel and asserts that exactly one caller gets it. This prevents regressions in the atomic claim logic.

3. **Priority shift tests.** After the priority auto-shift feature was added, tests verify:
   - Inserting at an occupied priority shifts existing rules down.
   - Cascade shifts work correctly (priority 2 occupied, then 2 becomes 3, 3 becomes 4, etc.).
   - Inserting at an unoccupied priority triggers no shift.

4. **E2E tests run the full stack** (Fastify + MongoDB + orchestrator + rule engine) in a single test process. They catch integration issues that unit tests miss.

### Introducing a New Rule Safely

1. **Create a feature branch** from `main` (e.g., `feat/fragile-handling`).
2. **Write the test first**: Add a test case in `e2e.test.ts` that creates a rule via the API, submits a matching parcel, and asserts the parcel is routed to the expected department.
3. **If the rule requires a new operator or field**, add it to the rule engine with unit tests.
4. **Run the full test suite** (`npm test`) — all 162+ tests must pass.
5. **Push and open a PR**. The CI pipeline (`.github/workflows/ci.yml`) runs: lint, typecheck, test, and build.
6. **Merge to main** after CI passes and review is complete.

If the new rule is purely a data change (no new operators or fields), it can be added at runtime through the admin UI without any code changes — this is the whole point of the data-driven rule engine.

### Validating Correctness Beyond Automated Tests

- **Structured logging (Pino)**: Every parcel processing step is logged with the `correlationId`, matched rule, and department. These logs can be searched to verify routing decisions.
- **Immutable audit trail**: The `outcomes` collection stores every routing decision with the exact rule version that was applied. This allows post-hoc verification.
- **Routing drift detection**: Statistical anomaly detection (see Monitoring section) flags when a department's share of parcels deviates significantly from its baseline, which can indicate a misconfigured rule.
- **`/ready` endpoint**: Returns 503 if the orchestrator's heartbeat is stale, making it detectable by load balancers and monitoring systems.

### Feature Development: Branch to Merge

The commit history on `feat/parcel-routing-system` demonstrates incremental feature development:

```
0bf8f13  Initial commit
2b23494  chore: initialize monorepo workspace and development toolchain
25189d7  feat(shared): implement composable routing rule engine and domain models
e9f8348  feat(api): implement fastify server, mongodb schemas, auth, and rest endpoints
378c54f  feat(pipeline): implement atomic claim orchestrator and piscina worker pool
991fc10  feat(ingestion): implement streaming saxes xml parser and batch ingestion
e38d01d  feat(observability): integrate sentry sdk for api and web with custom metrics
404e727  feat(web): implement operator dashboard, batch upload, and approval ui
aa39842  test(ci): add e2e test suite, github actions workflow, and system documentation
...
0224c52  feat: auto-shift priorities on rule create instead of rejecting conflicts
```

Each commit builds on the previous one, and the CI pipeline validates every push. This demonstrates how a new feature (e.g., priority auto-shifting) can be developed, tested, and merged without breaking existing functionality.

---

## 4. Monitoring and Reliability

### Observability Stack

The system uses **Sentry** for error tracking, performance monitoring, and cron job health. When `SENTRY_DSN` is set in `.env`, the following are enabled:

| Component | What It Does |
| :--- | :--- |
| **Error Tracking** | Unhandled exceptions are captured with full stack traces and sent to Sentry. |
| **Custom Metrics** | `parcels_processed` (counter by status/department), `parcel_processing_duration` (distribution in ms), `pending_parcels` / `failed_parcels` / `oldest_received_age_seconds` (gauges). |
| **Cron Monitors (Dead Man's Switch)** | The orchestrator sends a cron check-in to Sentry every 60 seconds. If Sentry stops receiving check-ins (the orchestrator is down or stuck), an alert fires automatically. The monitor is registered programmatically — no manual Sentry dashboard setup required. |
| **Correlation IDs** | Every API request gets a unique `x-correlation-id` header. This ID is attached to logs, Sentry events, and the parcel document, enabling request tracing across the entire pipeline. |

### Health and Readiness

| Endpoint | Purpose |
| :--- | :--- |
| `GET /health` | Returns `200 OK` if the HTTP server is running. Used by load balancers for basic liveness. |
| `GET /ready` | Returns `200 OK` only if MongoDB is connected **and** the orchestrator heartbeat is fresh (within `READY_STALENESS_MS`). Returns `503` if either check fails. Used by orchestrators (Kubernetes, etc.) to determine if the instance should receive traffic. |

### Routing Drift Detection

The system includes a statistical anomaly detector (`apps/api/src/observability/drift.ts`) that compares each department's share of parcels in the **last hour** against its share over the **trailing 7 days** using z-scores:

```
z = (p_hour - p_7day) / sqrt(p_7day * (1 - p_7day) / n_hour)
```

If the absolute value of z exceeds 2.0 (configurable via `DRIFT_Z_THRESHOLD`), the department is flagged. This catches scenarios like:
- A rule change accidentally routes 80% of parcels to one department.
- A department that normally handles 5% suddenly gets 30%.

Drift checks run periodically (default: every 5 minutes, configurable via `DRIFT_CHECK_INTERVAL_MS`) and are logged as warnings.

### Failure Handling

| Failure | How the System Handles It |
| :--- | :--- |
| **Worker crash during processing** | The parcel remains in `CLAIMED` status. After 60 seconds, `recoverStaleClaims()` resets it to `RECEIVED` for reprocessing. |
| **Rule engine throws an error** | The parcel's `retryCount` is incremented. After 3 retries, it is marked `FAILED` with the error message recorded in the outcome. |
| **No rule matches a parcel** | The parcel is marked `UNROUTED` with reason "No matching rule found". This is a terminal state (not retried) — it indicates a gap in the rule configuration. |
| **MongoDB connection drops** | The `/ready` endpoint returns `503`. The orchestrator's tick loop catches the error, logs it, and retries on the next tick. |
| **Orchestrator stops ticking** | The Sentry cron monitor (Dead Man's Switch) fires an alert. `/ready` returns `503` due to stale heartbeat. |

---

## 5. Security

### Implemented Measures

| Measure | Implementation | Why |
| :--- | :--- | :--- |
| **JWT Authentication** | Every mutating endpoint requires a valid `Authorization: Bearer <token>` header. Tokens are verified using `jose` (HS256). Missing/invalid/expired tokens return 401. | Prevents unauthorized access to the API. |
| **Role-Based Access Control (RBAC)** | Three roles: `operator` (submit parcels), `admin` (manage rules), `insurance_approver` (approve/reject). Wrong role returns 403. | Ensures operators cannot modify routing rules and approvers cannot submit parcels. |
| **Strict Input Validation (Zod `.strict()`)** | All API inputs are validated with Zod schemas using `.strict()` mode. Unknown fields return 400 with "Unrecognized key(s)" error. | Prevents mass assignment attacks where an attacker injects unexpected fields. |
| **Security Headers (Helmet)** | `@fastify/helmet` sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, CSP, and other headers. | Mitigates XSS, clickjacking, MIME sniffing, and other browser-level attacks. |
| **Rate Limiting** | `@fastify/rate-limit` limits requests per IP (default: 100/minute). Returns `429 Too Many Requests` with `Retry-After` header. | Prevents brute-force attacks and DoS. |
| **Input Sanitization** | HTML tags are stripped from all free-text fields (parcel names, addresses, custom attribute keys and values) before storage. | Defense-in-depth against stored XSS. |
| **XXE Immunity** | The XML parser uses SAXes (a streaming parser) which does not resolve external entities or DTDs. | Prevents XML External Entity attacks that could read server files or trigger SSRF. |
| **Idempotency Keys** | `POST /parcels` accepts an optional `Idempotency-Key` header. Duplicate submissions with the same key return the original response instead of creating a duplicate parcel. | Prevents accidental double-processing from network retries. |
| **PII Scrubbing** | Sentry's `beforeSend` hook scrubs recipient names and addresses from error reports before they leave the server. | Prevents personally identifiable information from being sent to third-party services. |

### Additional Measures for Production

The following measures are not implemented in this codebase but would be critical for a public-facing deployment:

1. **HTTPS/TLS Termination**: Deploy behind a reverse proxy (Nginx, Cloudflare, AWS ALB) that handles TLS. The application itself should only accept connections from the proxy.

2. **JWKS Instead of Symmetric Secrets**: Replace the shared `JWT_SECRET` with asymmetric keys from an identity provider (e.g., Auth0, Azure AD). This allows key rotation without redeploying the application.

3. **CORS Configuration**: Restrict `Access-Control-Allow-Origin` to the specific frontend domain rather than allowing all origins.

4. **Database Authentication**: Use MongoDB SCRAM-SHA-256 authentication with a dedicated application user that has only the minimum required permissions (read/write to specific collections, no `dbAdmin` or `clusterAdmin`).

5. **Secrets Management**: Use a vault (AWS Secrets Manager, HashiCorp Vault) instead of `.env` files. Rotate JWT secrets and database credentials periodically.

6. **Audit Logging**: Log all admin actions (rule creation, rule updates, approvals) to a tamper-evident audit log for compliance.

---

## 6. Extending the System with New Routing Rules

### Scenario: Add an "Express Department" for high-priority parcels

**If it only requires existing operators and fields (e.g., `weight`, `value`, `custom.*`):**

No code changes required. An admin creates the rule through the Rules Management page:

1. Navigate to **Rules Management** and click **+ New Rule**.
2. Fill in:
   - Name: `Express Department`
   - Priority: `1` (will auto-shift existing rules down)
   - Field: `custom.expressTier` / Operator: `eq` / Value: `gold`
   - Route to: `Express`
3. Click **Create Rule**. The orchestrator picks up the new rule on its next tick.

**If it requires a new operator (e.g., `contains`, `startsWith`):**

1. Add the operator function to `packages/shared/src/rule-engine/operators.ts`.
2. Register it in the `OPERATORS` map.
3. Add unit tests for the new operator.
4. Run `npm test` to verify nothing is broken.
5. The new operator is immediately available for use in rule conditions.

**If it requires a new system field on parcels (e.g., `senderCountry`):**

1. Add the field to the `Parcel` type in `packages/shared/src/rule-engine/types.ts`.
2. Add it to `KNOWN_TOP_LEVEL_FIELDS` in `packages/shared/src/rule-engine/field-resolver.ts`.
3. Update the parcel input Zod schema in `packages/shared/src/schemas/`.
4. Update the parcel form in the frontend to include the new field.
5. Add tests and deploy.

Note: For most business changes, the first approach (data-only, no code) is sufficient. The `custom.*` namespace was designed specifically to avoid the third approach as much as possible.

---

## Trade-offs

| Decision | Benefit | Cost |
| :--- | :--- | :--- |
| **MongoDB claim-based pipeline instead of RabbitMQ/SQS** | No additional infrastructure to deploy and monitor. Simpler architecture. | Throughput ceiling; not suitable for very high volume. |
| **Polling instead of WebSockets for live updates** | Simpler to implement, debug, and deploy behind proxies. Automatic reconnection. | Higher latency (up to 2s delay) and more HTTP requests than WebSocket push. |
| **Monorepo instead of separate repos** | Single `npm install`, shared types, atomic cross-package changes. | Larger repo size; CI runs all tests even if only one package changed. |
| **Symmetric JWT (HS256) instead of asymmetric (RS256/JWKS)** | Simpler setup for development and small deployments. | Requires sharing the secret between issuer and verifier. Not suitable for multi-service production without a vault. |
| **In-process orchestrator instead of a separate worker service** | Single deployment artifact. Simpler ops. | Cannot scale workers independently from the API server. |
| **Streaming XML parser (SAXes) instead of DOM parser** | Handles large files without memory spikes. Immune to XXE by design. | More complex parser code; harder to debug than a DOM-based parser. |
| **Auto-shift priorities instead of rejecting conflicts** | Better UX — admin can always insert a rule at the desired position. | Silent modification of existing rules' priorities may surprise admins if they don't notice the shift. |

---

## AI Usage Documentation

AI tools were used extensively during development. Below is a summary of how they were used, what was modified, and reflections on their limitations.

### Where AI Was Used

1. **Architecture and Design**: AI was used to brainstorm the claim-based pipeline design, the rule engine's composable architecture, and the field resolver's namespace separation. The final designs were reviewed and modified for correctness and simplicity.

2. **Code Generation**: AI generated initial implementations for:
   - The streaming XML parser (`xml-stream-parser.ts`)
   - The Sentry integration (`sentry.ts`, `metrics.ts`)
   - The drift detection algorithm (`drift.ts`)
   - Test suites across all layers

3. **Test Writing**: AI was used to generate comprehensive test cases, including edge cases (concurrent claims, stale recovery, field shadowing, expired JWTs). Each generated test was reviewed to ensure it tests meaningful behavior rather than implementation details.

4. **Documentation**: This README was drafted with AI assistance and reviewed for accuracy against the actual codebase.

### What Was Modified and Why

- **Rule Engine Field Resolver**: AI initially generated a version that allowed arbitrary dot-path traversal on the parcel object. This was modified to enforce strict namespace separation (`custom.*` vs system fields) to prevent custom attributes from shadowing system fields — a security and correctness concern that the AI did not proactively identify.

- **Priority Conflict Handling**: AI initially implemented a strict "reject on conflict" approach (HTTP 409). This was later changed to auto-shift priorities based on user feedback about the workflow — demonstrating that AI-generated designs need to be validated against real user needs.

- **XML Parser**: AI generated an initial version using `fast-xml-parser` (a DOM parser). This was replaced with SAXes (a streaming SAX parser) for two reasons: memory efficiency with large files, and structural immunity to XXE attacks. The AI did not flag XXE as a concern with the DOM parser.

### Understanding of Generated Code

All generated code was reviewed, understood, and in many cases modified before committing. Key areas of understanding:

- The z-score formula in drift detection and why `minSample` is needed to avoid false positives with small datasets.
- Why `findOneAndUpdate` with a filter on `status: RECEIVED` provides atomic claim semantics.
- Why the unique partial index on `{ priority: 1, active: true }` requires updating priorities from highest to lowest during the auto-shift operation.
- Why Sentry's `beforeSend` hook is the correct place for PII scrubbing (it runs before data leaves the process).

### Limitations of AI in This Context

1. **Security blind spots**: AI did not proactively identify XXE risks in XML parsing or field shadowing risks in the custom attribute system. These were caught during manual review.

2. **User experience assumptions**: AI optimized for "correct" behavior (rejecting priority conflicts) rather than "usable" behavior (auto-shifting priorities). Real-world UX requirements often differ from what seems logically correct.

3. **Over-engineering tendency**: AI sometimes suggested adding complexity (WebSockets, Redis caching, Kubernetes-specific health checks) that was unnecessary for the scale of this system. Knowing when NOT to add complexity is a human engineering judgment.

4. **Test quality**: AI-generated tests sometimes tested implementation details rather than behavior. For example, testing that a specific MongoDB method was called rather than testing the observable outcome. These were refactored to test behavior.

5. **Context limitations**: AI could not verify claims against the live codebase without explicit prompting. In one instance, a feature was described as working in the frontend when it was only implemented in the backend. This reinforced the importance of verifying AI claims against the actual code.
