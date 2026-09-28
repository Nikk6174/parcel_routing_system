# Phase 5 — API Routes & Ingestion

> **Status:** ✅ Complete
> **Depends on:** Phase 2 (engine), Phase 3 (repos), Phase 4 (pipeline)
> **Next phase:** Phase 6

---

## What was implemented

Phase 5 adds all REST API endpoints, streaming XML/JSON parsers,
authorization middleware, and idempotency key storage.

### Files created

| Location | File | Responsibility |
|----------|------|----------------|
| `packages/shared/src/schemas/` | `parcel-input.ts` | Zod schema for parcel input validation |
| `apps/api/src/parsers/` | `xml-stream-parser.ts` | SAX-based streaming XML parser (saxes) |
| | `json-stream-parser.ts` | Streaming JSON array parser |
| `apps/api/src/middleware/` | `authorize.ts` | Stub role-based auth (X-Role header) |
| `apps/api/src/db/` | `idempotency-repository.ts` | Idempotency key storage with TTL |
| `apps/api/src/routes/` | `parcel-routes.ts` | POST /parcels, GET /parcels/:parcelId |
| | `batch-routes.ts` | POST /parcels/batch, GET /parcels/batch/:batchId/status |
| | `rule-routes.ts` | POST /rules, PUT /rules/:id |
| | `approval-routes.ts` | POST /approve, POST /reject |
| | `routes.test.ts` | 15 integration tests |

### Files modified

| File | Change |
|------|--------|
| `apps/api/src/app.ts` | Full rewrite: wire multipart, repos, routes |
| `apps/api/src/db/parcel-repository.ts` | Added `insertMany()`, `countByStatusForBatch()` |
| `apps/api/src/db/index.ts` | Added `IdempotencyRepository` export |
| `packages/shared/src/index.ts` | Added schemas re-export |

### Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `routes.test.ts` | 15 | All endpoints, validation, auth, idempotency, XML/JSON uploads, malformed files |
| **Phase 5 total** | **15** | |
| **Cumulative total** | **140** | Phase 1–4: 125 + Phase 5: 15 |

---

## Endpoints

| Method | Path | Auth | Status | Purpose |
|--------|------|------|--------|---------|
| POST | `/parcels` | None | 202 | Submit single parcel |
| GET | `/parcels/:parcelId` | None | 200 | Get parcel + outcome |
| POST | `/parcels/batch` | None | 202 | Upload JSON/XML batch file |
| GET | `/parcels/batch/:batchId/status` | None | 200 | Aggregate status counts |
| POST | `/rules` | admin | 201 | Create routing rule |
| PUT | `/rules/:id` | admin | 200 | Update rule (new version) |
| POST | `/parcels/:parcelId/approve` | insurance-approver | 200 | Approve pending parcel |
| POST | `/parcels/:parcelId/reject` | insurance-approver | 200 | Reject pending parcel |

---

## correlationId flow

```
POST /parcels
  → crypto.randomUUID() generates correlationId
  → req.log.child({ correlationId })    ← all logs include it
  → ParcelDocument.correlationId = id   ← written to DB
  → Response: { parcelId, correlationId }

POST /parcels/batch
  → Each row gets its own correlationId
  → Shared batchId across all rows
  → req.log.child({ batchId })

Pipeline (Phase 4)
  → Reads parcel.correlationId from DB
  → Passes through to worker.ts
  → Worker output includes correlationId
  → OutcomeDocument.correlationId
  → All error/retry logs include correlationId
```

---

## XML mapping layer

```
XML Source:                     Internal ParcelInput:
─────────────────────────       ─────────────────────────
<Parcel>
  <Weight>0.02</Weight>     →  weight: 0.02 (parseFloat)
  <Value>500</Value>        →  value: 500 (parseFloat)
  <Receipient>
    <Name>Jan</Name>        →  recipient.name: "Jan"
    <Address>
      <Street>...</Street>  →  recipient.address.street
      <HouseNumber>100</>   →  recipient.address.houseNumber
      <PostalCode>1015</>   →  recipient.address.postalCode
      <City>Amsterdam</>    →  recipient.address.city
    </Address>
  </Receipient>
</Parcel>                   →  destinationCountry: "NL" (default)
                               custom: { _assumedCountry: true }
```

**Type coercion:** Weight/Value are text nodes in XML. Explicit `parseFloat` with
NaN check — rejects that specific row as FAILED, not the whole batch.

**Country default:** No country in the XML source → set `"NL"` + flag
`custom._assumedCountry: true` for traceability.

---

## Key design decisions

- **Row-level errors, not batch-level** — a single invalid row never fails the
  entire upload. Invalid rows are recorded with their reason; valid rows proceed
  normally. Response includes `rejectedDetails` with per-row reasons.

- **Idempotency via MongoDB collection** — uses `$setOnInsert` with upsert for
  race-condition safety. TTL index auto-expires keys after 24 hours. No external
  cache needed.

- **`createTestApp()` factory** — separate from production `createApp()` to
  avoid needing env vars in tests. Accepts a raw `Db` handle.

- **Multipart file detection** — checks both filename extension AND content-type.
  `.xml` or `application/xml` → XML parser. `.json` or `application/json` → JSON
  parser. Other formats get a 400.

- **`insertMany` for batch writes** — much more efficient than individual
  `insertOne` calls for batch uploads. Generates `_id` per document.

- **`countByStatusForBatch` aggregation** — uses `$match` + `$group` for a
  cheap aggregation query. Doesn't fetch every row.

---

## What this phase does NOT do (yet)

- **No real authentication** — stub middleware reads `X-Role` header. Phase 7
  adds JWT/session auth.
- **No rate limiting** — config exists (`RATE_LIMIT_MAX`) but not enforced.
- **No file deduplication** — idempotency is at the HTTP level (Idempotency-Key
  header), not at the file content level.
- **No CORS** — cross-origin requests not configured.
- **No request body size limit** — Fastify defaults. Multipart has 50MB limit.

---

## How to extend this later

**Adding a new endpoint:** Create a new route file in `apps/api/src/routes/`,
register it in `registerRoutes()` in `app.ts`, passing the required repos.

**Adding real auth:** Replace `authorize.ts` stub with JWT verification.
The preHandler hook pattern stays the same — just swap the implementation.

**Adding a new upload format:** Create a new parser function with the same
`(stream, onRow) => Promise<void>` signature, add format detection in
`batch-routes.ts`.
