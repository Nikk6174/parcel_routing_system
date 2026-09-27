# Parcel Routing System

A monorepo for the Parcel Routing System, built with Fastify, React, and MongoDB.

## Prerequisites

- Node.js ≥ 18.x
- npm ≥ 9.x
- MongoDB instance (local or remote)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your MongoDB connection string and other settings. See
[Configuration System](#configuration-system) for details.

### 3. Run in development mode

```bash
npm run dev
```

This starts all three packages concurrently:

| Package | URL | Description |
|---------|-----|-------------|
| **API** | http://localhost:3001 | Fastify backend |
| **Web** | http://localhost:5173 | React + Vite frontend |
| **Shared** | — | TypeScript watcher for shared types |

### Running individual apps

```bash
# API only
npm run dev:api

# Web only
npm run dev:web

# Shared types watcher
npm run dev:shared
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Format

```bash
# Write formatted output
npm run format

# Check only (CI)
npm run format:check
```

## Project Structure

```
/
├── apps/
│   ├── api/                  # Fastify backend
│   │   └── src/
│   │       ├── config/
│   │       │   ├── env.ts        # Zod-validated env config (fail-fast)
│   │       │   └── env.test.ts   # Config validation tests
│   │       ├── app.ts            # Fastify app factory
│   │       └── index.ts          # Server entry point
│   └── web/                  # React + Vite frontend
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── App.css
│           └── main.tsx
├── packages/
│   └── shared/               # Shared types & schemas
│       └── src/
│           └── index.ts          # ApiResponse envelope, etc.
├── .env.example              # Environment variable template
├── .env                      # Local environment (git-ignored)
├── tsconfig.base.json        # Shared TypeScript strict config
├── eslint.config.mjs         # ESLint 9 flat config
├── vitest.config.ts          # Root test runner config
└── README.md
```

## Configuration System

### Environment Configuration (env-level)

Environment-level configuration is loaded at startup from environment variables
(via `.env` file in development). The configuration is validated using Zod schemas
in [`apps/api/src/config/env.ts`](apps/api/src/config/env.ts). If any required
variable is missing or any value is invalid, the application **fails fast** with
a clear, readable error message and does not start.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | API server port |
| `MONGO_URI` | **Yes** | — | MongoDB connection string |
| `LOG_LEVEL` | No | `info` | Log level: `debug` · `info` · `warn` · `error` |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate-limit window in milliseconds |
| `JWT_SECRET` | **Yes** | — | HS256 signing key (≥ 32 chars). See [Security](#security). |

### Business-Rule Configuration (routing rules) — Phase 3

Routing rules (e.g., "parcels over 50 kg go to Department X") are **not** environment
configuration. They are business-level configuration that:

- Lives in **MongoDB**, not in environment variables or config files
- Can be modified at runtime without redeploying the application
- Is versioned and auditable (who changed what, when)
- Is loaded and cached by the API at startup and refreshed periodically

**Why are these separated?**

| Concern | Env config | Business-rule config |
|---------|-----------|---------------------|
| **What changes** | Ports, connection strings, log levels | Routing rules, thresholds, department mappings |
| **Who changes it** | Operators / DevOps | Business users / admins |
| **When it changes** | Per deploy / per environment | At any time, at runtime |
| **Where it lives** | `.env` / environment variables | MongoDB collection |
| **Change requires** | Restart (or re-read env) | No restart — hot-reloaded |

Mixing these concerns would make the system fragile: a routing-rule change should
never require a redeploy, and an infrastructure change should never risk corrupting
routing logic.

## Architecture Decisions

<!-- Append new decisions below this line -->

### ADR-001: Monorepo Tooling — npm Workspaces

**Decision:** Use npm workspaces (built into npm) for monorepo management.

**Context:** Evaluated npm workspaces, Turborepo, and Nx. Turborepo adds build
caching and task orchestration; Nx adds code generation and dependency-graph
visualization.

**Rationale:** npm workspaces is the simplest option that satisfies current
requirements (shared dependencies, cross-package references, unified scripts).
It introduces zero additional tooling dependencies. Turborepo or Nx can be
adopted later if build performance becomes a bottleneck.

### ADR-002: Configuration System — Zod Validation with Fail-Fast

**Decision:** Validate all environment variables at startup using Zod, failing
fast with readable errors.

**Rationale:** Silent configuration errors are a common source of production
incidents. By validating eagerly at startup, we catch misconfigurations during
deployment rather than at runtime when a code path first accesses an undefined
variable. The `loadConfig()` function accepts an injectable env record so the
validation logic itself is fully unit-testable.

### ADR-003: Testing — Vitest

**Decision:** Use Vitest for unit and integration testing across the monorepo.

**Rationale:** Vitest shares Vite's resolver and transform pipeline, ensuring
test-time module resolution matches dev-time resolution exactly. It supports
native ESM, has first-class TypeScript support, and is significantly faster
than Jest for ESM projects. A single root `vitest.config.ts` discovers tests
across all workspaces.

## Continuous Integration

A GitHub Actions workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
runs on every PR and push to `main`:

```
lint → typecheck → tests (unit + integration + e2e) → build
```

The pipeline fails the PR if any step fails. All tests use `mongodb-memory-server`
(in-process mongod binary) — no external services or Docker required.

### Branch protection recommendation

Configure the following in **GitHub → Settings → Branches → main → Branch protection**:

- ✅ Require status checks to pass before merging → select the `ci` job
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

This ensures no code reaches `main` with a red CI.

## Adding a new rule safely — branch to merge

A concrete walkthrough showing how the rule engine, test suite, and CI work together
to catch regressions.

**Scenario:** Add a rule that routes parcels over 30 kg to a "HEAVY" department.

### 1. Create a branch

```bash
git checkout -b feat/heavy-parcel-rule
```

### 2. Add a test for the new rule

In `packages/shared/src/rule-engine/rule-engine.test.ts`, add:

```typescript
it('routes parcels over 30kg to HEAVY department', () => {
  const rules: Rule[] = [{
    _id: 'heavy-rule',
    name: 'Heavy Parcel Route',
    priority: 1,
    type: 'condition_rule',
    conditions: { all: [{ field: 'weight', operator: '>', value: 30 }] },
    action: { route_to: 'HEAVY' },
    active: true,
    version: 1,
    createdBy: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
  }];

  const result = engine.evaluate(
    { weight: 35, value: 100, destinationCountry: 'NL', recipient: testRecipient, custom: {} },
    rules,
  );

  expect(result.status).toBe('ROUTED');
  expect(result.department).toBe('HEAVY');
});
```

### 3. Run tests locally

```bash
npm test
```

All tests pass including the new one — the rule engine already supports `>` conditions,
so no code changes are needed. The rule is created at runtime via `POST /rules`.

### 4. Add the rule to production (no code deploy)

```bash
curl -X POST https://your-api/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Heavy Parcel Route",
    "priority": 1,
    "type": "condition_rule",
    "conditions": { "all": [{ "field": "weight", "operator": ">", "value": 30 }] },
    "action": { "route_to": "HEAVY" },
    "createdBy": "ops-admin"
  }'
```

The rule is live immediately — no restart needed.

### 5. What happens if someone introduces a regression

Suppose a developer accidentally changes the `>` operator to mean `>=` instead of `>`.
The boundary test `'routes parcels over 30kg'` (weight: 35) still passes, but the
existing operator test for `>` with exact boundary values would fail:

```
FAIL  operators.test.ts > '>' operator > returns false when values are equal
```

CI blocks the PR from merging. The regression never reaches `main`.

### 6. Push and merge

```bash
git push origin feat/heavy-parcel-rule
# Open PR → CI runs → all green → merge
```

## Known Limitations & Scaling Path

### Current architecture: MongoDB-as-queue

The orchestrator uses MongoDB's `findOneAndUpdate` as an atomic claim mechanism.
Parcels are inserted with `status: RECEIVED`, claimed by workers via an atomic
status transition to `CLAIMED`, and updated to their final status after processing.

**Why this was chosen:**

- **Single dependency:** MongoDB serves as both the persistent store and the work
  queue, avoiding the operational overhead of a separate broker (RabbitMQ, SQS, etc.).
- **Simplicity:** No message serialization, no dead-letter configuration, no
  broker-specific client libraries. The claim mechanism is a single `findOneAndUpdate`.
- **Transactional safety:** The parcel document and its status live in the same store,
  so there's no two-phase commit between "acknowledge message" and "update database."

### Assumed initial scale

This design is appropriate for:

- **Throughput:** ~1,000 parcels/minute sustained (single API instance, single orchestrator).
- **Concurrency:** 1–4 worker threads per process (piscina pool).
- **Data volume:** Up to ~10M parcels in the collection before index performance degrades.

### The bottleneck: Mongo write/claim contention

Beyond ~5,000 parcels/minute, the bottleneck will be **write lock contention on
`findOneAndUpdate`**. Each claim attempt takes a write lock on the matched document.
With many concurrent claimers, MongoDB spends increasing time on lock acquisition
rather than actual work.

Symptoms that indicate you've hit this limit:

- `claimNext()` latency increases beyond 50ms p99
- `oldest_received_age_seconds` gauge climbs steadily
- MongoDB WiredTiger write tickets saturate

### Scaling path

| Scale | Solution |
|-------|----------|
| **2–5× current** | **Mongo sharding** on `status + createdAt` — distributes claim load across shards. Cheapest first step. |
| **10–50× current** | **Message broker** (RabbitMQ or AWS SQS) replaces the MongoDB claim mechanism. Parcels are still stored in MongoDB, but the claim/dispatch path moves to the broker. The orchestrator becomes a consumer. |
| **100×+ current** | **Event streaming** (Kafka) for ingestion, with MongoDB as the read-optimized store. Worker pools scale horizontally as consumer groups. |

**Migration path (OpenTelemetry):** The current Sentry-only observability stack can
be extended by adding an OpenTelemetry exporter to Sentry's SDK. This lets you send
the same traces and metrics to Prometheus/Grafana/Jaeger without changing
instrumentation code — you just add export targets.
