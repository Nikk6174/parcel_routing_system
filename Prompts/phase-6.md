# Phase 6 — Frontend (React + Vite)

> **Status:** ✅ Complete
> **Depends on:** Phase 5 (API routes)
> **Next phase:** Phase 7

---

## What was implemented

Phase 6 adds the complete React frontend in `apps/web/`.
Three screens: single-parcel form, batch upload, and paginated results table.

### Files created

| Location | File | Responsibility |
|----------|------|----------------|
| `apps/web/src/api/` | `client.ts` | Fetch wrapper, typed API calls |
| `apps/web/src/hooks/` | `usePolling.ts` | Polling hook with exponential backoff |
| `apps/web/src/utils/` | `sanitize.ts` | XSS defense-in-depth (HTML tag stripping) |
| `apps/web/src/components/` | `StatusBadge.tsx` | Color-coded status labels |
| | `ConnectionIndicator.tsx` | Live / stale / complete indicator |
| | `StatusBadge.test.tsx` | 10 tests: per-status rendering |
| | `BatchCounts.test.tsx` | 4 tests: aggregation display |
| `apps/web/src/pages/` | `ParcelForm.tsx` | Single parcel submit + polling |
| | `BatchUpload.tsx` | File picker + live batch counts |
| | `ResultsTable.tsx` | Paginated table + detail + approve/reject |
| `apps/web/src/` | `App.tsx` | Tab-based navigation |
| | `main.tsx` | Entry point |
| | `index.css` | Complete design system |
| | `test-setup.ts` | Vitest + jest-dom setup |
| `apps/web/` | `vitest.config.ts` | Vitest config for jsdom |

### Files modified

| File | Change |
|------|--------|
| `apps/web/vite.config.ts` | Added API proxy (/api → :3001) |
| `apps/web/package.json` | Added test script, deps |
| `apps/api/src/db/parcel-repository.ts` | Added `findPaginated()` |
| `apps/api/src/routes/parcel-routes.ts` | Added `GET /parcels` paginated list |

### Test coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `StatusBadge.test.tsx` | 10 | Per-status label + CSS class for all 9 statuses + unknown fallback |
| `BatchCounts.test.tsx` | 4 | Partial-failure shape, empty counts, ROUTED+APPROVED combo, FAILED+REJECTED combo |
| **Phase 6 total** | **14** | |
| **Cumulative total** | **154** | Phase 1–5: 140 + Phase 6: 14 |

---

## Screen map

```
┌─────────────────────────────────────────────────────────┐
│  Parcel Routing — Operations Dashboard                  │
├──────────────┬───────────────┬──────────────────────────┤
│ Submit Parcel│ Batch Upload  │ All Parcels              │
├──────────────┴───────────────┴──────────────────────────┤
│                                                         │
│  [Tab content area]                                     │
│                                                         │
│  Submit Parcel:                                         │
│    Form → submit → "Tracking result..." → terminal      │
│                                                         │
│  Batch Upload:                                          │
│    File picker → upload → summary → live counts         │
│    "X routed, Y held, Z failed, W pending"              │
│                                                         │
│  All Parcels:                                           │
│    Paginated table → click row → detail panel           │
│    PENDING_APPROVAL → approve/reject buttons            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Polling behavior

```
Initial interval: 2s
On success:       reset to 2s
On failure:       double interval (max 30s)
After 3 failures: show "Connection lost — data may be stale"
Terminal state:   stop polling, show "Complete — final update HH:MM:SS"

shouldStop logic:
  - Single parcel: ROUTED | APPROVED | REJECTED | FAILED | TIMED_OUT | UNROUTED
  - Batch: all counts are in terminal statuses (no RECEIVED/CLAIMED remaining)
```

---

## XSS prevention

1. **React's default escaping** — JSX interpolation `{value}` automatically
   escapes HTML entities. This prevents XSS for all rendered text.

2. **Explicit `sanitize()` utility** — strips HTML tags as defense-in-depth.
   Called on ALL user-entered values before rendering:
   - `parcel.recipient.name`
   - `parcel.custom` keys and values
   - `outcome.department`, `outcome.reason`

3. **No `dangerouslySetInnerHTML` anywhere** — all rendering uses safe JSX.

---

## Key design decisions

- **Tab navigation instead of router** — three views share one layout with no
  deep-linking requirement. Simple state is clearer than routing boilerplate.
  Adding react-router later is trivial if URLs become important.

- **Server-side pagination (20 per page)** — never more than 20 rows in the DOM,
  so virtualization isn't needed. Page 20 of 1000 rows costs the same as page 1.
  If the requirement changes to show 200+ rows, add `@tanstack/react-virtual`.

- **Polling hook is generic** — `usePolling<T>` works for any fetcher + any
  stop condition. Both single-parcel and batch polling use the same hook.

- **Client-side file checks are NOT a security boundary** — clearly commented
  in BatchUpload.tsx. Real validation (size, format, content) is server-side.

- **BatchCountsDisplay exported separately** — the aggregation component is
  exported for testing without mocking the entire upload flow.

- **Connection drop detection via failure count, not navigator.onLine** —
  `navigator.onLine` is unreliable in many environments. Tracking consecutive
  poll failures is more accurate and testable.

---

## What this phase does NOT do (yet)

- **No real authentication UI** — no login page. Auth is stubbed server-side.
- **No WebSocket/SSE** — uses polling, not push. Good enough for operator use.
- **No dark/light theme toggle** — always dark. Easy to add via CSS variables.
- **No i18n** — English only.
- **No accessibility audit** — semantic HTML is used but ARIA roles are minimal.

---

## How to extend this later

**Adding a new screen:** Create a page component in `pages/`, add a new tab in
`App.tsx`. If deep linking becomes important, wrap tabs in `react-router-dom`.

**Switching from polling to WebSocket:** Replace `usePolling` with a
`useWebSocket` hook that has the same return type `{ data, isStale, ... }`.
Components don't change — they just get data faster.

**Adding dark/light toggle:** All colors are CSS variables in `:root`. Add a
`.theme-light` class that overrides them. Toggle the class on `<body>`.
